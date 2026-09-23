# Staff Permissions and Audit History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `ADMIN` role with scoped staff permissions (`ADMIN`, `SUPPORT`, `OPERATIONS`, `MODERATOR`), provide an immutable `StaffAuditLog` with before/after state diffs, enforce Step-Up TOTP authentication for privileged actions, and build an audit search and retention portal at `/admin/audit`.

**Architecture:** Extend the Prisma `Role` enum and add `StaffAuditLog` with `onDelete: SetNull` for actor account isolation. Implement typed permissions in `lib/staffPermissions.ts` and authorization checks in `lib/staffAuthorization.ts`. Enforce Step-Up TOTP authentication via `lib/staffMfa.ts` for privileged operations. Provide `StaffAuditService` and `StaffAuditRetentionService` for transactional logging, querying, and 365-day retention purging with self-auditing. Protect admin routes and server actions with permission guards and present an accessible audit trail UI at `/admin/audit`.

**Tech Stack:** Next.js 14, React 18, TypeScript, Prisma ORM, PostgreSQL, NextAuth.js, OTPAuth (TOTP), Zod, Jest.

**Spec:** [`docs/superpowers/specs/2026-09-23-staff-permissions-and-audit-history-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/docs/superpowers/specs/2026-09-23-staff-permissions-and-audit-history-design.md)

## Global Constraints

- Runtime engine: Node.js 22 (`>=22 <23`).
- PostgreSQL migration scripts must start with `SET LOCAL lock_timeout = '3s';`.
- Zero committed secrets and zero high-severity npm vulnerabilities.
- Verification gates: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:database`.
- Immutability guarantee: `StaffAuditLog` must be strictly insert-only; no update endpoints or actions.

---

### Task 1: Database Schema & Migration for Scoped Roles and Audit Log

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260923120000_staff_permissions_and_audit/migration.sql`
- Test: `__tests__/database/staffPermissionsSchema.database.test.ts`

**Interfaces:**
- Produces:
  - Extended `Role` enum: `USER`, `ADMIN`, `SUPPORT`, `OPERATIONS`, `MODERATOR`.
  - `model StaffAuditLog`: `id`, `actorId`, `actorEmail`, `actorRole`, `action`, `targetType`, `targetId`, `beforeState`, `afterState`, `reason`, `metadata`, `ipAddress`, `createdAt`.
  - `User.staffAuditsInitiated` relation.

- [ ] **Step 1: Write the failing database test**

Create `__tests__/database/staffPermissionsSchema.database.test.ts`:
```typescript
/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';

describe('Staff Permissions and Audit Schema Database Integration', () => {
    const createdUserIds: string[] = [];
    const createdAuditIds: string[] = [];

    afterAll(async () => {
        if (createdAuditIds.length > 0) {
            await prisma.staffAuditLog.deleteMany({
                where: { id: { in: createdAuditIds } },
            });
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
        await prisma.$disconnect();
    });

    it('supports all scoped staff roles on User model', async () => {
        const roles: Role[] = ['USER', 'ADMIN', 'SUPPORT', 'OPERATIONS', 'MODERATOR'];
        for (const role of roles) {
            const user = await prisma.user.create({
                data: {
                    email: `role-test-${role.toLowerCase()}-${randomUUID()}@example.com`,
                    name: `${role} User`,
                    role,
                    emailVerified: new Date(),
                },
            });
            createdUserIds.push(user.id);
            expect(user.role).toBe(role);
        }
    });

    it('persists StaffAuditLog with beforeState and afterState and preserves log on user deletion (SetNull)', async () => {
        const staffUser = await prisma.user.create({
            data: {
                email: `staff-actor-${randomUUID()}@example.com`,
                name: 'Audited Staff',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(staffUser.id);

        const audit = await prisma.staffAuditLog.create({
            data: {
                actorId: staffUser.id,
                actorEmail: staffUser.email!,
                actorRole: staffUser.role,
                action: 'SCHEDULE_TERMS_UPDATE',
                targetType: 'FlightSchedule',
                targetId: '42',
                beforeState: { terms: 'Original terms', active: true },
                afterState: { terms: 'Updated terms', active: false },
                reason: 'Operational schedule review',
                metadata: { clientIp: '127.0.0.1', userAgent: 'Jest-Test' },
                ipAddress: '127.0.0.1',
            },
        });
        createdAuditIds.push(audit.id);

        expect(audit.actorId).toBe(staffUser.id);
        expect(audit.actorEmail).toBe(staffUser.email);
        expect(audit.beforeState).toEqual({ terms: 'Original terms', active: true });
        expect(audit.afterState).toEqual({ terms: 'Updated terms', active: false });

        // Delete the staff user and verify onDelete: SetNull leaves audit log intact
        await prisma.user.delete({ where: { id: staffUser.id } });
        const remainingAudit = await prisma.staffAuditLog.findUnique({
            where: { id: audit.id },
        });

        expect(remainingAudit).not.toBeNull();
        expect(remainingAudit?.actorId).toBeNull();
        expect(remainingAudit?.actorEmail).toBe(staffUser.email);
        expect(remainingAudit?.actorRole).toBe('ADMIN');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:database -- staffPermissionsSchema.database.test.ts`
Expected: FAIL (PrismaClientValidationError / type error: role values or staffAuditLog not recognized).

- [ ] **Step 3: Update schema.prisma and create migration**

Modify `prisma/schema.prisma`:
```prisma
enum Role {
  USER
  ADMIN
  SUPPORT
  OPERATIONS
  MODERATOR
}

model User {
  // ... existing fields
  staffAuditsInitiated    StaffAuditLog[]       @relation("StaffAuditActor")
}

model StaffAuditLog {
  id          String    @id @default(cuid())
  actorId     String?
  actor       User?     @relation("StaffAuditActor", fields: [actorId], references: [id], onDelete: SetNull)
  actorEmail  String
  actorRole   Role
  action      String
  targetType  String
  targetId    String
  beforeState Json?
  afterState  Json?
  reason      String?
  metadata    Json?
  ipAddress   String?
  createdAt   DateTime  @default(now())

  @@index([actorId])
  @@index([action])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

Create migration directory `prisma/migrations/20260923120000_staff_permissions_and_audit/migration.sql`:
```sql
SET LOCAL lock_timeout = '3s';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPPORT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MODERATOR';

-- CreateTable
CREATE TABLE "StaffAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAuditLog_actorId_idx" ON "StaffAuditLog"("actorId");
CREATE INDEX "StaffAuditLog_action_idx" ON "StaffAuditLog"("action");
CREATE INDEX "StaffAuditLog_targetType_targetId_idx" ON "StaffAuditLog"("targetType", "targetId");
CREATE INDEX "StaffAuditLog_createdAt_idx" ON "StaffAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "StaffAuditLog" ADD CONSTRAINT "StaffAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Run:
```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:database -- staffPermissionsSchema.database.test.ts`
Expected: PASS (2 tests passed).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260923120000_staff_permissions_and_audit/migration.sql __tests__/database/staffPermissionsSchema.database.test.ts
git commit -m "feat(schema): add scoped staff roles and StaffAuditLog model (#85)"
```

---

### Task 2: Scoped Permissions Matrix and Authorization Helpers

**Files:**
- Create: `lib/staffPermissions.ts`
- Modify: `lib/staffAuthorization.ts`
- Modify: `lib/auth.ts:70-165`
- Test: `__tests__/lib/staffPermissions.test.ts`
- Test: `__tests__/lib/staffAuthorization.test.ts`

**Interfaces:**
- Produces:
  - `StaffPermission` enum: `BOOKINGS_READ`, `BOOKINGS_WRITE`, `BOOKINGS_REFUND`, `BOOKINGS_CANCEL`, `SCHEDULES_READ`, `SCHEDULES_WRITE`, `SCHEDULES_DELETE`, `FLIGHT_STATUS_UPDATE`, `REVIEWS_MODERATE`, `CITY_GUIDES_WRITE`, `NOTIFICATIONS_READ`, `NOTIFICATIONS_RESEND`, `USERS_READ`, `USERS_MANAGE_ROLES`, `AUDIT_LOGS_VIEW`, `AUDIT_LOGS_PURGE`.
  - `ROLE_PERMISSIONS: Record<Role, readonly StaffPermission[]>`.
  - `isStaffRole(role?: Role | null): boolean`.
  - `hasStaffPermission(session: Session | null, permission: StaffPermission): boolean`.
  - `hasVerifiedStaffAccess(session: Session | null): boolean`.

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/lib/staffPermissions.test.ts`:
```typescript
import { Role } from '@prisma/client';
import { StaffPermission, ROLE_PERMISSIONS } from '@/lib/staffPermissions';

describe('Staff Permissions Matrix', () => {
    it('grants ADMIN all permissions', () => {
        const allPermissions = Object.values(StaffPermission);
        expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(allPermissions.length);
        for (const permission of allPermissions) {
            expect(ROLE_PERMISSIONS.ADMIN).toContain(permission);
        }
    });

    it('grants SUPPORT bookings, notifications, and user read permissions only', () => {
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_READ);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_WRITE);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_REFUND);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_CANCEL);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.NOTIFICATIONS_READ);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.NOTIFICATIONS_RESEND);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.USERS_READ);

        // Denied areas
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.SCHEDULES_WRITE);
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.SCHEDULES_DELETE);
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.USERS_MANAGE_ROLES);
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.AUDIT_LOGS_PURGE);
    });

    it('grants OPERATIONS schedule and flight status permissions only', () => {
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.SCHEDULES_READ);
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.SCHEDULES_WRITE);
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.SCHEDULES_DELETE);
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.FLIGHT_STATUS_UPDATE);

        // Denied areas
        expect(ROLE_PERMISSIONS.OPERATIONS).not.toContain(StaffPermission.BOOKINGS_REFUND);
        expect(ROLE_PERMISSIONS.OPERATIONS).not.toContain(StaffPermission.USERS_MANAGE_ROLES);
    });

    it('grants MODERATOR review and city guide permissions only', () => {
        expect(ROLE_PERMISSIONS.MODERATOR).toContain(StaffPermission.REVIEWS_MODERATE);
        expect(ROLE_PERMISSIONS.MODERATOR).toContain(StaffPermission.CITY_GUIDES_WRITE);

        // Denied areas
        expect(ROLE_PERMISSIONS.MODERATOR).not.toContain(StaffPermission.BOOKINGS_READ);
        expect(ROLE_PERMISSIONS.MODERATOR).not.toContain(StaffPermission.SCHEDULES_WRITE);
    });

    it('grants USER zero staff permissions', () => {
        expect(ROLE_PERMISSIONS.USER).toEqual([]);
    });
});
```

Create / Update `__tests__/lib/staffAuthorization.test.ts`:
```typescript
import {
    hasVerifiedStaffAccess,
    hasStaffPermission,
    isStaffRole,
} from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';

describe('Staff Authorization Helpers', () => {
    describe('isStaffRole', () => {
        it('returns true for staff roles', () => {
            expect(isStaffRole('ADMIN')).toBe(true);
            expect(isStaffRole('SUPPORT')).toBe(true);
            expect(isStaffRole('OPERATIONS')).toBe(true);
            expect(isStaffRole('MODERATOR')).toBe(true);
        });

        it('returns false for USER, undefined, or null', () => {
            expect(isStaffRole('USER')).toBe(false);
            expect(isStaffRole(undefined)).toBe(false);
            expect(isStaffRole(null)).toBe(false);
        });
    });

    describe('hasStaffPermission', () => {
        it('returns false if session is missing or MFA is unverified', () => {
            expect(hasStaffPermission(null, StaffPermission.BOOKINGS_READ)).toBe(false);
            expect(hasStaffPermission({
                user: { id: 'u1', role: 'ADMIN', staffMfaVerified: false }
            } as never, StaffPermission.BOOKINGS_READ)).toBe(false);
        });

        it('returns true when role possesses the requested permission and MFA is verified', () => {
            expect(hasStaffPermission({
                user: { id: 'u1', role: 'SUPPORT', staffMfaVerified: true }
            } as never, StaffPermission.BOOKINGS_REFUND)).toBe(true);

            expect(hasStaffPermission({
                user: { id: 'u1', role: 'OPERATIONS', staffMfaVerified: true }
            } as never, StaffPermission.SCHEDULES_WRITE)).toBe(true);
        });

        it('returns false when role lacks the requested permission even if MFA is verified', () => {
            expect(hasStaffPermission({
                user: { id: 'u1', role: 'SUPPORT', staffMfaVerified: true }
            } as never, StaffPermission.SCHEDULES_DELETE)).toBe(false);

            expect(hasStaffPermission({
                user: { id: 'u1', role: 'OPERATIONS', staffMfaVerified: true }
            } as never, StaffPermission.USERS_MANAGE_ROLES)).toBe(false);
        });
    });

    describe('hasVerifiedStaffAccess (backward compatibility)', () => {
        it('returns true for any staff role with verified MFA', () => {
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'ADMIN', staffMfaVerified: true } } as never)).toBe(true);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'SUPPORT', staffMfaVerified: true } } as never)).toBe(true);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'OPERATIONS', staffMfaVerified: true } } as never)).toBe(true);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'MODERATOR', staffMfaVerified: true } } as never)).toBe(true);
        });

        it('returns false for USER role or unverified MFA', () => {
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'USER', staffMfaVerified: true } } as never)).toBe(false);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'ADMIN', staffMfaVerified: false } } as never)).toBe(false);
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/staffPermissions.test.ts __tests__/lib/staffAuthorization.test.ts`
Expected: FAIL (modules not found or functions missing).

- [ ] **Step 3: Implement staffPermissions.ts, staffAuthorization.ts, and update auth.ts**

Create `lib/staffPermissions.ts`:
```typescript
import { Role } from '@prisma/client';

export enum StaffPermission {
    BOOKINGS_READ = 'BOOKINGS_READ',
    BOOKINGS_WRITE = 'BOOKINGS_WRITE',
    BOOKINGS_REFUND = 'BOOKINGS_REFUND',
    BOOKINGS_CANCEL = 'BOOKINGS_CANCEL',
    SCHEDULES_READ = 'SCHEDULES_READ',
    SCHEDULES_WRITE = 'SCHEDULES_WRITE',
    SCHEDULES_DELETE = 'SCHEDULES_DELETE',
    FLIGHT_STATUS_UPDATE = 'FLIGHT_STATUS_UPDATE',
    REVIEWS_MODERATE = 'REVIEWS_MODERATE',
    CITY_GUIDES_WRITE = 'CITY_GUIDES_WRITE',
    NOTIFICATIONS_READ = 'NOTIFICATIONS_READ',
    NOTIFICATIONS_RESEND = 'NOTIFICATIONS_RESEND',
    USERS_READ = 'USERS_READ',
    USERS_MANAGE_ROLES = 'USERS_MANAGE_ROLES',
    AUDIT_LOGS_VIEW = 'AUDIT_LOGS_VIEW',
    AUDIT_LOGS_PURGE = 'AUDIT_LOGS_PURGE',
}

export const ROLE_PERMISSIONS: Record<Role, readonly StaffPermission[]> = {
    USER: [],
    ADMIN: Object.values(StaffPermission),
    SUPPORT: [
        StaffPermission.BOOKINGS_READ,
        StaffPermission.BOOKINGS_WRITE,
        StaffPermission.BOOKINGS_REFUND,
        StaffPermission.BOOKINGS_CANCEL,
        StaffPermission.NOTIFICATIONS_READ,
        StaffPermission.NOTIFICATIONS_RESEND,
        StaffPermission.USERS_READ,
    ],
    OPERATIONS: [
        StaffPermission.SCHEDULES_READ,
        StaffPermission.SCHEDULES_WRITE,
        StaffPermission.SCHEDULES_DELETE,
        StaffPermission.FLIGHT_STATUS_UPDATE,
    ],
    MODERATOR: [
        StaffPermission.REVIEWS_MODERATE,
        StaffPermission.CITY_GUIDES_WRITE,
    ],
};
```

Update `lib/staffAuthorization.ts`:
```typescript
import { Session } from 'next-auth';
import { Role } from '@prisma/client';
import { StaffPermission, ROLE_PERMISSIONS } from './staffPermissions';

export function isStaffRole(role?: Role | null): boolean {
    return role !== undefined && role !== null && role !== 'USER';
}

export function hasStaffPermission(
    session: Session | null,
    permission: StaffPermission
): boolean {
    if (!session?.user?.role || !isStaffRole(session.user.role)) return false;
    if (session.user.staffMfaVerified !== true) return false;
    const permissions = ROLE_PERMISSIONS[session.user.role] ?? [];
    return permissions.includes(permission);
}

export function hasVerifiedStaffAccess(session: Session | null): boolean {
    return isStaffRole(session?.user?.role) && session.user.staffMfaVerified === true;
}
```

Update `lib/auth.ts`: Replace checks for `user.role === 'ADMIN'` with `isStaffRole(user.role)` so all staff roles undergo MFA enrollment/verification, session expiry, and token validation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/staffPermissions.test.ts __tests__/lib/staffAuthorization.test.ts`
Expected: PASS (all tests passing).

- [ ] **Step 5: Commit**

```bash
git add lib/staffPermissions.ts lib/staffAuthorization.ts lib/auth.ts __tests__/lib/staffPermissions.test.ts __tests__/lib/staffAuthorization.test.ts
git commit -m "feat(auth): implement scoped staff permissions matrix and authorization helpers (#85)"
```

---

### Task 3: Step-Up TOTP Authentication for Privileged Operations

**Files:**
- Modify: `lib/staffMfa.ts`
- Modify: `lib/validation.ts`
- Test: `__tests__/lib/staffStepUpAuth.test.ts`

**Interfaces:**
- Produces:
  - `PRIVILEGED_PERMISSIONS: readonly StaffPermission[]`.
  - `StaffUnauthorizedError` and `StaffStepUpRequiredError`.
  - `assertPrivilegedStaffOperation(options: { session, permission, stepUpCode?, maxStepUpAgeMs? }): Promise<{ actorId: string, actorEmail: string, actorRole: Role }>`.
  - `stepUpCodeSchema` in `lib/validation.ts`.

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/lib/staffStepUpAuth.test.ts`:
```typescript
import {
    assertPrivilegedStaffOperation,
    PRIVILEGED_PERMISSIONS,
    StaffStepUpRequiredError,
    StaffUnauthorizedError,
} from '@/lib/staffMfa';
import { StaffPermission } from '@/lib/staffPermissions';
import { prisma } from '@/lib/prisma';
import * as staffMfaModule from '@/lib/staffMfa';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));

describe('Step-Up TOTP Authentication', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('throws StaffUnauthorizedError when user lacks the required permission', async () => {
        const session = {
            user: { id: 'u1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
        } as never;

        await expect(
            assertPrivilegedStaffOperation({
                session,
                permission: StaffPermission.SCHEDULES_DELETE,
            })
        ).rejects.toThrow(StaffUnauthorizedError);
    });

    it('permits non-privileged operations without step-up code', async () => {
        const session = {
            user: { id: 'u1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
        } as never;

        const result = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.BOOKINGS_READ,
        });

        expect(result.actorId).toBe('u1');
        expect(result.actorRole).toBe('SUPPORT');
    });

    it('throws StaffStepUpRequiredError when privileged operation lacks recent step-up and no code provided', async () => {
        const session = {
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        } as never;

        await expect(
            assertPrivilegedStaffOperation({
                session,
                permission: StaffPermission.USERS_MANAGE_ROLES,
            })
        ).rejects.toThrow(StaffStepUpRequiredError);
    });

    it('verifies step-up TOTP code successfully when valid code is provided', async () => {
        const session = {
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        } as never;

        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'admin1',
            staffMfaSecretEncrypted: 'encrypted-secret',
        });

        jest.spyOn(staffMfaModule, 'verifyAndConsumeStaffTotp').mockResolvedValue(true);

        const result = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.USERS_MANAGE_ROLES,
            stepUpCode: '123456',
        });

        expect(result.actorId).toBe('admin1');
        expect(result.actorEmail).toBe('admin@example.com');
        expect(result.actorRole).toBe('ADMIN');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/staffStepUpAuth.test.ts`
Expected: FAIL (functions and error classes not defined).

- [ ] **Step 3: Implement step-up verification logic and validation schema**

Modify `lib/validation.ts`: Add `stepUpCodeSchema`:
```typescript
export const stepUpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Security code must be exactly 6 digits');
```

Modify `lib/staffMfa.ts`:
```typescript
import { StaffPermission } from './staffPermissions';
import { hasStaffPermission } from './staffAuthorization';
import { Role } from '@prisma/client';

export class StaffUnauthorizedError extends Error {
    constructor(message = 'Unauthorized staff operation.') {
        super(message);
        this.name = 'StaffUnauthorizedError';
    }
}

export class StaffStepUpRequiredError extends Error {
    readonly permission: StaffPermission;
    constructor(permission: StaffPermission, message = 'Step-up TOTP authentication required.') {
        super(message);
        this.name = 'StaffStepUpRequiredError';
        this.permission = permission;
    }
}

export const PRIVILEGED_PERMISSIONS: readonly StaffPermission[] = [
    StaffPermission.USERS_MANAGE_ROLES,
    StaffPermission.SCHEDULES_DELETE,
    StaffPermission.AUDIT_LOGS_PURGE,
    StaffPermission.BOOKINGS_REFUND,
];

export async function assertPrivilegedStaffOperation(options: {
    session: Session | null;
    permission: StaffPermission;
    stepUpCode?: string;
    maxStepUpAgeMs?: number;
}): Promise<{ actorId: string; actorEmail: string; actorRole: Role }> {
    const { session, permission, stepUpCode, maxStepUpAgeMs = 15 * 60 * 1000 } = options;
    if (!session?.user?.id || !session.user.email || !session.user.role || !hasStaffPermission(session, permission)) {
        throw new StaffUnauthorizedError();
    }

    const isPrivileged = PRIVILEGED_PERMISSIONS.includes(permission);
    if (!isPrivileged) {
        return {
            actorId: session.user.id,
            actorEmail: session.user.email,
            actorRole: session.user.role,
        };
    }

    const stepUpVerifiedAt = session.user.staffMfaStepUpVerifiedAt;
    const isWithinWindow = stepUpVerifiedAt && (Date.now() - stepUpVerifiedAt < maxStepUpAgeMs);

    if (!isWithinWindow) {
        if (!stepUpCode || !/^\d{6}$/.test(stepUpCode.trim())) {
            throw new StaffStepUpRequiredError(permission);
        }

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { staffMfaSecretEncrypted: true },
        });

        if (!user?.staffMfaSecretEncrypted) {
            throw new StaffUnauthorizedError('Staff MFA is not configured.');
        }

        const isValid = await verifyAndConsumeStaffTotp(
            session.user.id,
            user.staffMfaSecretEncrypted,
            stepUpCode.trim()
        );

        if (!isValid) {
            throw new StaffStepUpRequiredError(permission, 'Invalid security code. Please check your authenticator.');
        }
    }

    return {
        actorId: session.user.id,
        actorEmail: session.user.email,
        actorRole: session.user.role,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/staffStepUpAuth.test.ts`
Expected: PASS (4 tests passing).

- [ ] **Step 5: Commit**

```bash
git add lib/staffMfa.ts lib/validation.ts __tests__/lib/staffStepUpAuth.test.ts
git commit -m "feat(auth): implement step-up TOTP verification for privileged operations (#85)"
```

---

### Task 4: Audit Logging Domain Service & Retention Engine

**Files:**
- Create: `lib/staffAuditService.ts`
- Create: `lib/staffAuditRetentionService.ts`
- Modify: `lib/validation.ts`
- Test: `__tests__/database/staffAuditService.database.test.ts`

**Interfaces:**
- Produces:
  - `recordStaffAudit(entry: StaffAuditInput, tx?: Prisma.TransactionClient): Promise<StaffAuditLog>`.
  - `searchStaffAuditLogs(query: StaffAuditQuery): Promise<{ logs: StaffAuditLog[], totalCount: number, hasNextPage: boolean }>`.
  - `purgeExpiredAuditLogs(options): Promise<{ dryRun: boolean, eligibleCount?: number, deletedCount?: number, cutoffDate: Date }>`.
  - Schemas: `staffAuditInputSchema`, `staffAuditQuerySchema`, `auditRetentionPurgeSchema`.

- [ ] **Step 1: Write the failing database integration test**

Create `__tests__/database/staffAuditService.database.test.ts`:
```typescript
/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { recordStaffAudit, searchStaffAuditLogs } from '@/lib/staffAuditService';
import { purgeExpiredAuditLogs } from '@/lib/staffAuditRetentionService';

describe('Staff Audit and Retention Service Database Integration', () => {
    const createdAuditIds: string[] = [];
    const createdUserIds: string[] = [];

    afterAll(async () => {
        if (createdAuditIds.length > 0) {
            await prisma.staffAuditLog.deleteMany({
                where: { id: { in: createdAuditIds } },
            });
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
        await prisma.$disconnect();
    });

    it('records and queries audit logs with structured diffs', async () => {
        const actor = await prisma.user.create({
            data: {
                email: `auditor-${randomUUID()}@example.com`,
                name: 'Auditor User',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(actor.id);

        const audit1 = await recordStaffAudit({
            actorId: actor.id,
            actorEmail: actor.email!,
            actorRole: 'ADMIN',
            action: 'USER_ROLE_UPDATE',
            targetType: 'User',
            targetId: 'target-123',
            beforeState: { role: 'USER' },
            afterState: { role: 'SUPPORT' },
            reason: 'Customer service onboarding',
        });
        createdAuditIds.push(audit1.id);

        const searchResult = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            action: 'USER_ROLE_UPDATE',
            limit: 10,
        });

        expect(searchResult.logs).toHaveLength(1);
        expect(searchResult.logs[0].id).toBe(audit1.id);
        expect(searchResult.logs[0].beforeState).toEqual({ role: 'USER' });
        expect(searchResult.logs[0].afterState).toEqual({ role: 'SUPPORT' });
    });

    it('accurately previews and purges records older than retention cutoff with self-audit', async () => {
        const actor = await prisma.user.create({
            data: {
                email: `purge-admin-${randomUUID()}@example.com`,
                name: 'Purge Admin',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(actor.id);

        // Create an old audit log (400 days old)
        const oldLog = await prisma.staffAuditLog.create({
            data: {
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'ADMIN',
                action: 'LEGACY_ACTION',
                targetType: 'LegacyTarget',
                targetId: '999',
                createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
            },
        });
        createdAuditIds.push(oldLog.id);

        // Dry-run preview
        const dryRunResult = await purgeExpiredAuditLogs({
            retentionDays: 365,
            dryRun: true,
            actor: { id: actor.id, email: actor.email!, role: 'ADMIN' },
            reason: 'Testing dry run purge',
        });

        expect(dryRunResult.dryRun).toBe(true);
        expect(dryRunResult.eligibleCount).toBeGreaterThanOrEqual(1);

        // Live purge
        const livePurgeResult = await purgeExpiredAuditLogs({
            retentionDays: 365,
            dryRun: false,
            actor: { id: actor.id, email: actor.email!, role: 'ADMIN' },
            reason: 'Annual compliance retention purge',
        });

        expect(livePurgeResult.dryRun).toBe(false);
        expect(livePurgeResult.deletedCount).toBeGreaterThanOrEqual(1);

        // Verify oldLog is gone
        const fetchedOld = await prisma.staffAuditLog.findUnique({ where: { id: oldLog.id } });
        expect(fetchedOld).toBeNull();

        // Verify the purge itself created a StaffAuditLog entry
        const purgeAudit = await prisma.staffAuditLog.findFirst({
            where: { action: 'AUDIT_RETENTION_PURGE', actorEmail: actor.email! },
        });
        expect(purgeAudit).not.toBeNull();
        if (purgeAudit) createdAuditIds.push(purgeAudit.id);
        expect(purgeAudit?.reason).toBe('Annual compliance retention purge');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:database -- staffAuditService.database.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement validation schemas, staffAuditService, and staffAuditRetentionService**

Update `lib/validation.ts`: Add `staffAuditInputSchema`, `staffAuditQuerySchema`, and `auditRetentionPurgeSchema`.

Create `lib/staffAuditService.ts`:
```typescript
import { prisma } from './prisma';
import { Prisma, Role, StaffAuditLog } from '@prisma/client';
import { parseInput, staffAuditInputSchema, staffAuditQuerySchema } from './validation';
import logger from './logger';

export interface StaffAuditInput {
    actorId: string;
    actorEmail: string;
    actorRole: Role;
    action: string;
    targetType: string;
    targetId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
}

export async function recordStaffAudit(
    entry: StaffAuditInput,
    tx?: Prisma.TransactionClient
): Promise<StaffAuditLog> {
    const validated = parseInput(staffAuditInputSchema, entry);
    const client = tx ?? prisma;

    const auditLog = await client.staffAuditLog.create({
        data: {
            actorId: validated.actorId,
            actorEmail: validated.actorEmail,
            actorRole: validated.actorRole,
            action: validated.action,
            targetType: validated.targetType,
            targetId: validated.targetId,
            beforeState: (validated.beforeState as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            afterState: (validated.afterState as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            reason: validated.reason ?? null,
            metadata: (validated.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            ipAddress: validated.ipAddress ?? null,
        },
    });

    logger.info(`Staff audit recorded: ${validated.action}`, {
        auditId: auditLog.id,
        actorEmail: validated.actorEmail,
        action: validated.action,
        targetType: validated.targetType,
        targetId: validated.targetId,
    });

    return auditLog;
}

export interface StaffAuditQuery {
    dateFrom?: string | Date;
    dateTo?: string | Date;
    actorId?: string;
    actorEmail?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    limit?: number;
    cursor?: string;
}

export async function searchStaffAuditLogs(query: StaffAuditQuery) {
    const validated = parseInput(staffAuditQuerySchema, query);
    const where: Prisma.StaffAuditLogWhereInput = {};

    if (validated.actorId) where.actorId = validated.actorId;
    if (validated.actorEmail) where.actorEmail = { contains: validated.actorEmail, mode: 'insensitive' };
    if (validated.action && validated.action !== 'ALL') where.action = validated.action;
    if (validated.targetType) where.targetType = validated.targetType;
    if (validated.targetId) where.targetId = validated.targetId;

    if (validated.dateFrom || validated.dateTo) {
        where.createdAt = {};
        if (validated.dateFrom) where.createdAt.gte = new Date(validated.dateFrom);
        if (validated.dateTo) where.createdAt.lte = new Date(validated.dateTo);
    }

    const limit = validated.limit ?? 25;
    const [totalCount, logs] = await Promise.all([
        prisma.staffAuditLog.count({ where }),
        prisma.staffAuditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            cursor: validated.cursor ? { id: validated.cursor } : undefined,
            include: { actor: { select: { name: true, image: true } } },
        }),
    ]);

    const hasNextPage = logs.length > limit;
    const results = hasNextPage ? logs.slice(0, limit) : logs;
    const nextCursor = hasNextPage ? results[results.length - 1]?.id : null;

    return {
        logs: results,
        totalCount,
        hasNextPage,
        nextCursor,
    };
}
```

Create `lib/staffAuditRetentionService.ts`:
```typescript
import { prisma } from './prisma';
import { Role } from '@prisma/client';
import { recordStaffAudit } from './staffAuditService';
import logger from './logger';

export async function purgeExpiredAuditLogs(options: {
    retentionDays?: number;
    dryRun?: boolean;
    actor: { id: string; email: string; role: Role };
    reason: string;
}) {
    const retentionDays = options.retentionDays ?? 365;
    const dryRun = options.dryRun ?? true;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const eligibleCount = await prisma.staffAuditLog.count({
        where: { createdAt: { lt: cutoffDate } },
    });

    if (dryRun) {
        return {
            dryRun: true,
            eligibleCount,
            cutoffDate,
        };
    }

    return prisma.$transaction(async (tx) => {
        const deleteResult = await tx.staffAuditLog.deleteMany({
            where: { createdAt: { lt: cutoffDate } },
        });

        await recordStaffAudit({
            actorId: options.actor.id,
            actorEmail: options.actor.email,
            actorRole: options.actor.role,
            action: 'AUDIT_RETENTION_PURGE',
            targetType: 'StaffAuditLog',
            targetId: 'BULK',
            reason: options.reason,
            metadata: {
                deletedCount: deleteResult.count,
                retentionDays,
                cutoffDate: cutoffDate.toISOString(),
            },
        }, tx);

        logger.warn('Staff audit retention purge executed', {
            deletedCount: deleteResult.count,
            retentionDays,
            cutoffDate,
            actor: options.actor.email,
        });

        return {
            dryRun: false,
            deletedCount: deleteResult.count,
            cutoffDate,
        };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:database -- staffAuditService.database.test.ts`
Expected: PASS (2 tests passed).

- [ ] **Step 5: Commit**

```bash
git add lib/staffAuditService.ts lib/staffAuditRetentionService.ts lib/validation.ts __tests__/database/staffAuditService.database.test.ts
git commit -m "feat(audit): implement audit recording, search, and retention purge engine (#85)"
```

---

### Task 5: Server Actions, User Role Management & Existing Action Instrumentation

**Files:**
- Create: `app/actions/staffAuditActions.ts`
- Create: `app/actions/userRoleActions.ts`
- Modify: `app/actions.ts` (instrument schedule & booking actions)
- Modify: `app/actions/reviewActions.ts` (instrument review moderation)
- Modify: `app/admin/layout.tsx`
- Test: `__tests__/actions/staffAuditActions.test.ts`
- Test: `__tests__/actions/userRoleActions.test.ts`

**Interfaces:**
- Produces:
  - `searchStaffAuditLogsAction(query)`: requires `AUDIT_LOGS_VIEW`.
  - `purgeExpiredAuditLogsAction(options)`: requires `AUDIT_LOGS_PURGE` + Step-Up TOTP.
  - `updateUserRoleAction({ userId, newRole, reason, stepUpCode })`: requires `USERS_MANAGE_ROLES` + Step-Up TOTP; bumps `authVersion` and writes `StaffAuditLog`.
  - Instrumentation: `updateFlightScheduleTermsAction`, `setFlightScheduleActiveAction`, `deleteFlightScheduleAction`, `moderateReviewAction` write to `StaffAuditLog`.

- [ ] **Step 1: Write the failing action unit tests**

Create `__tests__/actions/userRoleActions.test.ts`:
```typescript
import { updateUserRoleAction } from '@/app/actions/userRoleActions';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import * as staffMfaModule from '@/lib/staffMfa';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        staffAuditLog: {
            create: jest.fn(),
        },
        $transaction: jest.fn(callback => callback(prisma)),
    },
}));

describe('updateUserRoleAction', () => {
    it('rejects unauthorized users lacking USERS_MANAGE_ROLES', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'u1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
        });

        const result = await updateUserRoleAction({
            userId: 'target-1',
            newRole: 'ADMIN',
            reason: 'Promotion',
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/unauthorized/i);
    });

    it('requires step-up TOTP code for role modifications', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        });

        const result = await updateUserRoleAction({
            userId: 'target-1',
            newRole: 'SUPPORT',
            reason: 'New team member',
        });

        expect(result.success).toBe(false);
        expect(result.requiresStepUp).toBe(true);
    });

    it('updates user role, increments authVersion, and records audit on valid step-up code', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        });

        (prisma.user.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'admin1', staffMfaSecretEncrypted: 'enc-secret' })
            .mockResolvedValueOnce({ id: 'target-1', email: 'target@example.com', role: 'USER', authVersion: 2 });

        jest.spyOn(staffMfaModule, 'verifyAndConsumeStaffTotp').mockResolvedValue(true);
        (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'target-1', role: 'SUPPORT', authVersion: 3 });

        const result = await updateUserRoleAction({
            userId: 'target-1',
            newRole: 'SUPPORT',
            reason: 'Promoted to support',
            stepUpCode: '123456',
        });

        expect(result.success).toBe(true);
        expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'target-1' },
            data: expect.objectContaining({ role: 'SUPPORT', authVersion: { increment: 1 } }),
        }));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/actions/userRoleActions.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement server actions and instrument existing actions**

Create `app/actions/userRoleActions.ts`:
```typescript
'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';
import { StaffPermission } from '@/lib/staffPermissions';
import { assertPrivilegedStaffOperation, StaffStepUpRequiredError } from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import { revalidatePath } from 'next/cache';

export async function updateUserRoleAction(input: {
    userId: string;
    newRole: Role;
    reason: string;
    stepUpCode?: string;
}) {
    const session = await getServerSession(authOptions);

    let actor;
    try {
        actor = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.USERS_MANAGE_ROLES,
            stepUpCode: input.stepUpCode,
        });
    } catch (error) {
        if (error instanceof StaffStepUpRequiredError) {
            return { success: false, requiresStepUp: true, error: error.message };
        }
        return { success: false, error: (error as Error).message || 'Unauthorized' };
    }

    const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
        return { success: false, error: 'User not found.' };
    }

    const previousRole = targetUser.role;

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: targetUser.id },
            data: {
                role: input.newRole,
                authVersion: { increment: 1 }, // Invalidate target user's active sessions
            },
        });

        await recordStaffAudit({
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
            actorRole: actor.actorRole,
            action: 'USER_ROLE_UPDATE',
            targetType: 'User',
            targetId: targetUser.id,
            beforeState: { role: previousRole, email: targetUser.email },
            afterState: { role: input.newRole, email: targetUser.email },
            reason: input.reason,
        }, tx);
    });

    revalidatePath('/admin/users');
    return { success: true };
}
```

Create `app/actions/staffAuditActions.ts`:
```typescript
'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { searchStaffAuditLogs, StaffAuditQuery } from '@/lib/staffAuditService';
import { purgeExpiredAuditLogs } from '@/lib/staffAuditRetentionService';
import { assertPrivilegedStaffOperation, StaffStepUpRequiredError } from '@/lib/staffMfa';
import { revalidatePath } from 'next/cache';

export async function searchStaffAuditLogsAction(query: StaffAuditQuery) {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.AUDIT_LOGS_VIEW)) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        const result = await searchStaffAuditLogs(query);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: (error as Error).message || 'Failed to search audit logs.' };
    }
}

export async function purgeExpiredAuditLogsAction(input: {
    retentionDays?: number;
    dryRun?: boolean;
    reason: string;
    stepUpCode?: string;
}) {
    const session = await getServerSession(authOptions);

    let actor;
    try {
        actor = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.AUDIT_LOGS_PURGE,
            stepUpCode: input.stepUpCode,
        });
    } catch (error) {
        if (error instanceof StaffStepUpRequiredError) {
            return { success: false, requiresStepUp: true, error: error.message };
        }
        return { success: false, error: (error as Error).message || 'Unauthorized' };
    }

    try {
        const result = await purgeExpiredAuditLogs({
            retentionDays: input.retentionDays,
            dryRun: input.dryRun,
            actor: { id: actor.actorId, email: actor.actorEmail, role: actor.actorRole },
            reason: input.reason,
        });
        if (!input.dryRun) {
            revalidatePath('/admin/audit');
        }
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: (error as Error).message || 'Failed to execute audit purge.' };
    }
}
```

Instrument schedule and moderation actions in `app/actions.ts` and `app/actions/reviewActions.ts`:
- Check permission with `hasStaffPermission(session, ...)`.
- Write `recordStaffAudit` inside the transaction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/actions/userRoleActions.test.ts`
Expected: PASS (all tests passing).

- [ ] **Step 5: Commit**

```bash
git add app/actions/userRoleActions.ts app/actions/staffAuditActions.ts app/actions.ts app/actions/reviewActions.ts app/admin/layout.tsx __tests__/actions/userRoleActions.test.ts
git commit -m "feat(actions): add role management and audit actions with instrumentation (#85)"
```

---

### Task 6: Staff Portals UI (Audit Search, Diff Viewer, User Roles, and StepUpModal)

**Files:**
- Create: `components/admin/StepUpModal.tsx`
- Create: `components/admin/StaffAuditPortalClient.tsx`
- Create: `app/admin/audit/page.tsx`
- Create: `components/admin/UserRoleManagementClient.tsx`
- Create: `app/admin/users/page.tsx`
- Modify: `app/admin/page.tsx`
- Test: `__tests__/components/StepUpModal.test.tsx`
- Test: `__tests__/components/StaffAuditPortalClient.test.tsx`

**Interfaces:**
- Produces:
  - Accessible `StepUpModal` component for TOTP prompts with keyboard focus trap.
  - Audit trail portal at `/admin/audit` with search, filter, state diff inspection modal, and retention purge controls.
  - Role management portal at `/admin/users` with user search, role update, and step-up confirmation.
  - Dynamic role-tailored dashboard navigation in `app/admin/page.tsx`.

- [ ] **Step 1: Write UI component tests**

Create `__tests__/components/StepUpModal.test.tsx`:
```typescript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StepUpModal from '@/components/admin/StepUpModal';

describe('StepUpModal', () => {
    it('renders dialog with accessible focus and title', () => {
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit TOTP code"
                onClose={jest.fn()}
                onSubmit={jest.fn()}
            />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Authorize Action')).toBeInTheDocument();
        expect(screen.getByLabelText(/security code/i)).toBeInTheDocument();
    });

    it('submits 6-digit code on valid input', () => {
        const handleSubmit = jest.fn();
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit code"
                onClose={jest.fn()}
                onSubmit={handleSubmit}
            />
        );

        const input = screen.getByLabelText(/security code/i);
        fireEvent.change(input, { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));

        expect(handleSubmit).toHaveBeenCalledWith('123456');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/StepUpModal.test.tsx`
Expected: FAIL (Component not found).

- [ ] **Step 3: Implement StepUpModal, Audit Portal Client, and User Role Portal**

Create `components/admin/StepUpModal.tsx`:
- Accessible modal dialog using `role="dialog"`, `aria-modal="true"`.
- Keyboard trap for `Tab` and `Shift+Tab`, closes on `Escape`.
- 6-digit input with auto-focus.

Create `components/admin/StaffAuditPortalClient.tsx`:
- Search inputs: Date range, Actor Email, Action select (`ALL`, `USER_ROLE_UPDATE`, `SCHEDULE_TERMS_UPDATE`, `AUDIT_RETENTION_PURGE`, etc.), Target.
- Audit table with column headers: Timestamp, Actor, Role badge, Action badge, Target, Reason, Details.
- Details button opens modal displaying `beforeState` and `afterState` side-by-side JSON comparison.
- Retention tab: Dry run button + live purge button that opens `StepUpModal`.

Create `app/admin/audit/page.tsx`:
- Server component checking `hasStaffPermission(session, StaffPermission.AUDIT_LOGS_VIEW)`.
- Renders `StaffAuditPortalClient`.

Create `components/admin/UserRoleManagementClient.tsx`:
- User table with search filter.
- Role select dropdown.
- Changing role opens confirmation dialog and prompts for `StepUpModal` if required.

Create `app/admin/users/page.tsx`:
- Server component checking `hasStaffPermission(session, StaffPermission.USERS_READ)`.
- Renders `UserRoleManagementClient`.

Modify `app/admin/page.tsx`:
- Update dashboard navigation cards to render only sections the staff member's role has permission to view (`BOOKINGS_READ`, `SCHEDULES_READ`, `REVIEWS_MODERATE`, `NOTIFICATIONS_READ`, `USERS_MANAGE_ROLES`, `AUDIT_LOGS_VIEW`).

- [ ] **Step 4: Run UI tests to verify they pass**

Run: `npx jest __tests__/components/StepUpModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/StepUpModal.tsx components/admin/StaffAuditPortalClient.tsx app/admin/audit/page.tsx components/admin/UserRoleManagementClient.tsx app/admin/users/page.tsx app/admin/page.tsx __tests__/components/StepUpModal.test.tsx
git commit -m "feat(ui): add audit search portal, diff viewer, and user role management (#85)"
```

---

### Task 7: Full Verification, Documentation & Landing

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-staff-permissions-and-audit-history.md`
- Test: All suites

**Interfaces:**
- Produces: 100% passing build and verification across all suites.

- [ ] **Step 1: Run complete typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run unit tests**

Run: `npm run test:unit`
Expected: 100% pass across all unit test suites.

- [ ] **Step 4: Run database tests**

Run: `npm run test:database`
Expected: 100% pass across all database test suites.

- [ ] **Step 5: Run security and migration verification**

Run:
```bash
npm audit --audit-level=high
node -e '
  const fs = require("fs");
  const path = require("path");
  const dir = "prisma/migrations";
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
  for (const e of entries) {
    const file = path.join(dir, e.name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    if (!sql.includes("SET LOCAL lock_timeout = '\''3s'\'';")) {
      console.error(`Migration ${e.name} missing lock_timeout!`);
      process.exit(1);
    }
  }
  console.log(`Verified ${entries.length} migrations include lock_timeout!`);
'
```
Expected: 0 vulnerabilities, all migrations verified.

- [ ] **Step 6: Commit and land**

```bash
git commit -m "chore: complete verification for staff permissions and audit history (#85)"
```
