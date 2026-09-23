# Design Specification: Staff Permissions and Audit History (Issue #85)

## 1. Executive Summary & Goals

### 1.1 Context
Currently, staff operations in the application rely on a single, all-or-nothing `ADMIN` role on the `User` model. While Phase 3.5 added TOTP MFA verification (`hasVerifiedStaffAccess`) and targeted audit records for reviews and notifications, it left administrative permissions monolithic: any staff member with the `ADMIN` role has unrestricted access to customer bookings, financial refunds, flight schedules, user roles, and moderation tools. Furthermore, changes across the system lack a unified, queryable, and immutable audit trail.

### 1.2 Objectives
This feature implements **Phase 4.3 (Issue #85)**:
1. **Scoped Staff Permissions**: Replace the single `ADMIN` role with scoped staff roles (`ADMIN`, `SUPPORT`, `OPERATIONS`, `MODERATOR`) mapped deterministically in code to granular permissions.
2. **Immutable Audit History**: Provide a centralized, immutable `StaffAuditLog` model recording actor, action, target, before/after state diffs, reason, and timestamps.
3. **Step-Up Authentication for Privileged Operations**: Enforce fresh TOTP verification for high-impact actions (e.g., role modification, schedule deletion, audit log purges, out-of-policy refunds).
4. **Audit Trail Portal & Retention Engine**: Provide a searchable staff portal at `/admin/audit` with state diff inspection, paired with a configurable 365-day retention policy and auditable purge mechanism.
5. **Least-Privilege Route & Action Protection**: Restrict admin routes and server actions strictly to users holding the necessary permissions.

---

## 2. Database Schema & Architecture

### 2.1 Prisma Schema Changes

#### Role Enum Expansion
```prisma
enum Role {
  USER
  ADMIN
  SUPPORT
  OPERATIONS
  MODERATOR
}
```

- `USER`: Regular traveler account with self-service booking capabilities.
- `ADMIN`: Superuser possessing all permissions, user role administration, and audit retention purge capabilities.
- `SUPPORT`: Customer service staff handling bookings, passenger data, seat changes, refunds, rebooking, and customer notifications.
- `OPERATIONS`: Flight operations staff managing flight schedules, aircraft assignments, and flight status tracking.
- `MODERATOR`: Content moderation staff reviewing travel guides and user review reports.

#### Unified `StaffAuditLog` Model
```prisma
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

#### User Model Relation Update
```prisma
model User {
  // ... existing fields
  staffAuditsInitiated StaffAuditLog[] @relation("StaffAuditActor")
}
```

### 2.2 Database Migration & Lock Safety
The PostgreSQL migration is saved under `prisma/migrations/<timestamp>_staff_permissions_and_audit/migration.sql`. In accordance with project standards:
- The script begins with:
  ```sql
  SET LOCAL lock_timeout = '3s';
  ```
- New enum values are appended to the existing `Role` type:
  ```sql
  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPPORT';
  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS';
  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MODERATOR';
  ```
- The `StaffAuditLog` table and its indexes are created.
- `onDelete: SetNull` ensures that if a user account is deleted in compliance with privacy retention, historical audit logs preserve the actor's snapshot (`actorEmail`, `actorRole`) without orphan constraint errors.

---

## 3. Permissions Matrix & Authorization Layer

### 3.1 Granular Permissions Definition (`lib/staffPermissions.ts`)
Permissions are strongly typed constants:

```typescript
export enum StaffPermission {
  // Booking & Customer Support
  BOOKINGS_READ = 'BOOKINGS_READ',
  BOOKINGS_WRITE = 'BOOKINGS_WRITE',
  BOOKINGS_REFUND = 'BOOKINGS_REFUND',
  BOOKINGS_CANCEL = 'BOOKINGS_CANCEL',

  // Flight Operations
  SCHEDULES_READ = 'SCHEDULES_READ',
  SCHEDULES_WRITE = 'SCHEDULES_WRITE',
  SCHEDULES_DELETE = 'SCHEDULES_DELETE',
  FLIGHT_STATUS_UPDATE = 'FLIGHT_STATUS_UPDATE',

  // Content Moderation
  REVIEWS_MODERATE = 'REVIEWS_MODERATE',
  CITY_GUIDES_WRITE = 'CITY_GUIDES_WRITE',

  // Notifications & Communications
  NOTIFICATIONS_READ = 'NOTIFICATIONS_READ',
  NOTIFICATIONS_RESEND = 'NOTIFICATIONS_RESEND',

  // User & Access Administration (Privileged)
  USERS_READ = 'USERS_READ',
  USERS_MANAGE_ROLES = 'USERS_MANAGE_ROLES',

  // Audit Logs & Compliance (Privileged)
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

### 3.2 Authorization Helpers (`lib/staffAuthorization.ts`)

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

/**
 * Backward-compatible helper: returns true if the user possesses ANY valid staff role
 * with verified staff MFA.
 */
export function hasVerifiedStaffAccess(session: Session | null): boolean {
  return isStaffRole(session?.user?.role) && session.user.staffMfaVerified === true;
}
```

### 3.3 Session & Token Synchronization (`lib/auth.ts`)
1. **JWT & Session Augmentation**:
   - `token.role` and `session.user.role` reflect the updated `Role` enum.
   - Staff MFA verification applies to any user where `isStaffRole(user.role)`.
   - When a user's role is updated in the database, `authVersion` is bumped, invalidating existing sessions and forcing a clean re-login with appropriate permissions.
2. **Session Expiry**:
   - Staff MFA verification expires after `STAFF_MFA_SESSION_MAX_AGE_MS` (8 hours).

---

## 4. Step-Up Authentication for Privileged Operations

### 4.1 Privileged Permissions Definition
High-impact operations carry risk of irreversible damage or privilege escalation:
```typescript
export const PRIVILEGED_PERMISSIONS: readonly StaffPermission[] = [
  StaffPermission.USERS_MANAGE_ROLES,
  StaffPermission.SCHEDULES_DELETE,
  StaffPermission.AUDIT_LOGS_PURGE,
  StaffPermission.BOOKINGS_REFUND,
];
```

### 4.2 Step-Up Verification Flow (`lib/staffMfa.ts`)
```typescript
export async function assertPrivilegedStaffOperation(options: {
  session: Session | null;
  permission: StaffPermission;
  stepUpCode?: string;
  maxStepUpAgeMs?: number; // Defaults to 15 minutes
}): Promise<{ actorId: string; actorEmail: string; actorRole: Role }>
```

1. Calls `hasStaffPermission(session, permission)`. If false, throws `StaffUnauthorizedError`.
2. If `permission` is in `PRIVILEGED_PERMISSIONS`:
   - Checks if `session.user.staffMfaStepUpVerifiedAt` exists and is within `maxStepUpAgeMs` (15 minutes).
   - If not within the window:
     - Requires `stepUpCode` to be present.
     - Fetches user's `staffMfaSecretEncrypted` and verifies `verifyAndConsumeStaffTotp(userId, secret, stepUpCode)`.
     - If code is invalid or missing, throws `StaffStepUpRequiredError`.
3. Returns authenticated actor context for audit logging.

---

## 5. Domain Services: Audit & Retention

### 5.1 Recording Audit Logs (`lib/staffAuditService.ts`)
```typescript
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
): Promise<StaffAuditLog>
```
- Validates input with `staffAuditInputSchema`.
- Accepts an optional Prisma transaction client `tx` so that the audit row is written atomically alongside the business mutation.
- Disallows any client or API-level mutation of existing `StaffAuditLog` rows (strictly insert-only).
- Emits structured log entries via `lib/logger.ts`.

### 5.2 Searching Audit Logs (`searchStaffAuditLogs`)
Supports filtering by:
- `dateFrom` and `dateTo`
- `actorId` or `actorEmail`
- `action` (e.g., `USER_ROLE_UPDATE`, `SCHEDULE_DELETE`, `BOOKING_REFUND`, `AUDIT_PURGE`)
- `targetType` and `targetId`
- Cursor / offset pagination with maximum page limit of 100 (default 25).
- Sorted by `createdAt: 'desc'`.

### 5.3 Audit Retention & Purge Engine (`lib/staffAuditRetentionService.ts`)
1. **Retention Window**:
   - Default: 365 days.
   - Cutoff calculation: `new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)`.
2. **Purge Implementation**:
   ```typescript
   export async function purgeExpiredAuditLogs(options: {
     retentionDays?: number; // Default 365
     dryRun?: boolean;       // Default true
     actor: { id: string; email: string; role: Role };
     reason: string;
     stepUpCode?: string;
   }): Promise<{ dryRun: boolean; eligibleCount?: number; deletedCount?: number; cutoffDate: Date }>
   ```
   - Requires `StaffPermission.AUDIT_LOGS_PURGE` (`ADMIN`) and valid Step-Up TOTP.
   - In `dryRun` mode: performs `count({ where: { createdAt: { lt: cutoffDate } } })` and returns without modification.
   - In live mode:
     - Deletes records matching `createdAt < cutoffDate`.
     - Transactionally writes a `StaffAuditLog` entry documenting the purge:
       - `action: 'AUDIT_RETENTION_PURGE'`
       - `targetType: 'StaffAuditLog'`
       - `targetId: 'BULK'`
       - `reason: options.reason`
       - `metadata: { deletedCount, retentionDays, cutoffDate }`

---

## 6. Staff Portals & Admin UI

### 6.1 Top-Level Layout Guard (`app/admin/layout.tsx`)
- Admits any user where `isStaffRole(session?.user?.role) && session.user.staffMfaVerified === true`.
- If user has a staff role but MFA is not enrolled, redirects to `/staff/mfa`.
- If regular user or unauthenticated, redirects to `/login`.

### 6.2 Admin Overview (`app/admin/page.tsx`)
The dashboard cards adapt to the user's role:
- **Bookings & Support**: Shown if `hasStaffPermission(session, BOOKINGS_READ)` (`ADMIN`, `SUPPORT`).
- **Flight Operations**: Shown if `hasStaffPermission(session, SCHEDULES_READ)` (`ADMIN`, `OPERATIONS`).
- **Review Moderation**: Shown if `hasStaffPermission(session, REVIEWS_MODERATE)` (`ADMIN`, `MODERATOR`).
- **Notifications & Audit**: Shown if `hasStaffPermission(session, NOTIFICATIONS_READ)` (`ADMIN`, `SUPPORT`).
- **Staff User Administration**: Shown if `hasStaffPermission(session, USERS_MANAGE_ROLES)` (`ADMIN`).
- **Audit Trail & Compliance**: Shown if `hasStaffPermission(session, AUDIT_LOGS_VIEW)` (`ADMIN`).

### 6.3 Audit Trail Portal (`app/admin/audit/page.tsx` & `StaffAuditPortalClient.tsx`)
- Route: `/admin/audit`.
- Protected by `StaffPermission.AUDIT_LOGS_VIEW`.
- Features:
  - Date range, actor email, action type, and target filters.
  - Interactive table showing timestamp, actor, action badge, target, and reason.
  - Diff Modal: accessible dialog displaying formatted JSON comparison of `beforeState` and `afterState`, actor IP, and metadata.
  - Retention Purge Panel (visible only with `AUDIT_LOGS_PURGE`):
    - Dry-run count calculator.
    - Purge action button triggering confirmation dialog and Step-Up TOTP input.

### 6.4 User Role Administration (`app/admin/users/page.tsx` & `UserRoleManagementClient.tsx`)
- Route: `/admin/users`.
- Protected by `StaffPermission.USERS_READ` and `StaffPermission.USERS_MANAGE_ROLES`.
- Lists users with search by name/email, current role badge, and MFA status.
- Changing a user's role opens a confirmation prompt with mandatory reason and Step-Up TOTP code input.
- Bumps user's `authVersion` on update to invalidate active sessions.

### 6.5 Reusable Step-Up Modal (`components/admin/StepUpModal.tsx`)
- Accessible modal component with keyboard focus trap (`Tab`, `Shift+Tab`, `Escape`).
- 6-digit numeric input with auto-formatting.
- Submits `stepUpCode` to the requested action; displays error banner on invalid code.

---

## 7. Existing Action Instrumentation

The following server actions are updated to enforce scoped permissions and write structured audit records:

1. **User Management**:
   - `updateUserRoleAction`: Requires `USERS_MANAGE_ROLES` + Step-Up TOTP. Logs `beforeState: { role: oldRole }`, `afterState: { role: newRole }`.
2. **Flight Operations**:
   - `updateFlightScheduleTermsAction`: Requires `SCHEDULES_WRITE`. Logs before/after terms.
   - `setFlightScheduleActiveAction`: Requires `SCHEDULES_WRITE`. Logs active flag toggle.
   - `deleteFlightScheduleAction`: Requires `SCHEDULES_DELETE` + Step-Up TOTP. Logs schedule snapshot.
3. **Review Moderation**:
   - `moderateReviewAction` / `deleteReviewAction`: Requires `REVIEWS_MODERATE`. Writes to `StaffAuditLog` in addition to domain-specific moderation tables.
4. **Customer Bookings & Support**:
   - `staffCancelBookingAction` / `staffRefundBookingAction`: Requires `BOOKINGS_CANCEL` / `BOOKINGS_REFUND`. Logs refund amounts and cancellation reasons.

---

## 8. Verification & Testing Strategy

### 8.1 Unit Tests
- `__tests__/lib/staffPermissions.test.ts`: Complete role-permission coverage matrix and boundary checks.
- `__tests__/lib/staffAuthorization.test.ts`: Role checks, unauthenticated sessions, unverified MFA, session expiration.
- `__tests__/lib/staffMfa.test.ts`: Step-Up TOTP validation, expired TOTP, cache expiration after 15 minutes.
- `__tests__/components/StepUpModal.test.tsx`: Focus trap, validation of 6 digits, submit, cancel.
- `__tests__/components/StaffAuditPortalClient.test.tsx`: Search inputs, pagination, diff viewer modal toggle.
- `__tests__/components/UserRoleManagementClient.test.tsx`: Role dropdown, step-up trigger, state sync.

### 8.2 Database Tests (`npm run test:database`)
- `__tests__/database/staffAudit.database.test.ts`:
  - `recordStaffAudit` transactional persistence and JSON state verification.
  - Foreign key handling (`onDelete: SetNull` on user deletion).
  - `searchStaffAuditLogs` filtering across multiple parameters.
  - `purgeExpiredAuditLogs`: dry-run vs live purge, retention cutoff enforcement, purge self-auditing.
- `__tests__/database/userRoles.database.test.ts`:
  - Assignment of `SUPPORT`, `OPERATIONS`, `MODERATOR`, `ADMIN`, `USER`.
  - Session invalidation via `authVersion`.

### 8.3 Quality & CI Standard
All changes must satisfy:
- Node.js 22 runtime compatibility.
- `npx prisma generate` clean compilation.
- `npx tsc --noEmit` with 0 errors.
- `npm run lint` with 0 warnings/errors.
- 100% passing unit and database test suites.
- Migration verification passing `SET LOCAL lock_timeout = '3s';`.
- Zero committed secrets or high-severity vulnerabilities.

---

## 9. Phased Implementation Slices

1. **Slice 1: Database Schema & Migration**
   - Expand `Role` enum with `SUPPORT`, `OPERATIONS`, `MODERATOR`.
   - Add `StaffAuditLog` model and relations.
   - Generate migration with `SET LOCAL lock_timeout = '3s';`.
   - Write database tests for schema and audit model.

2. **Slice 2: Permissions Matrix & Step-Up Auth**
   - Create `lib/staffPermissions.ts` with typed permissions and `ROLE_PERMISSIONS`.
   - Update `lib/staffAuthorization.ts` with `hasStaffPermission` and `isStaffRole`.
   - Implement `assertPrivilegedStaffOperation` and Step-Up TOTP helpers in `lib/staffMfa.ts`.
   - Unit tests covering all permission pairs and step-up paths.

3. **Slice 3: Audit Domain & Retention Services**
   - Create `lib/staffAuditService.ts` (`recordStaffAudit`, `searchStaffAuditLogs`).
   - Create `lib/staffAuditRetentionService.ts` (`purgeExpiredAuditLogs` with dry-run).
   - Write database integration tests for audit search and retention purge.

4. **Slice 4: Server Actions & Audit Instrumentation**
   - Implement `app/actions/staffAuditActions.ts` and `app/actions/userRoleActions.ts`.
   - Instrument existing staff actions (schedules, moderation, booking refunds) to write audit records.
   - Enforce per-route permissions in `app/admin/layout.tsx` and sub-routes.

5. **Slice 5: Staff Portals UI**
   - Implement `StepUpModal.tsx`.
   - Implement Audit Trail portal at `/admin/audit` with search and state diff modal.
   - Implement User Role Administration portal at `/admin/users`.
   - Update admin dashboard navigation cards.

6. **Slice 6: Full Verification, Documentation & Landing**
   - Run full verification suite (`tsc`, `lint`, `test:unit`, `test:database`).
   - Create pull request and track CI checks to green.
   - Land PR and close Issue #85.
