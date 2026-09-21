# Notification Preferences & Delivery Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement production-ready notification preferences and multi-channel delivery (In-App and Email) with graceful failure degradation, durable delivery audits, staff retry administration, and traveler preference controls for Issue #82.

**Architecture:** A normalized `NotificationPreference` and `NotificationDelivery` schema in PostgreSQL with Prisma ORM; a domain service (`NotificationService`) managing default preference fallbacks, resilient multi-channel dispatches, and staff delivery retries; Mailpit/Postmark email adapter; typed Server Actions with staff MFA guards; accessible traveler matrix settings UI at `/profile/notifications`; and a staff audit portal at `/admin/notifications`.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript 5, Prisma 5, PostgreSQL, Zod, Jest, Testing Library, Tailwind CSS.

**Spec:** [`docs/superpowers/specs/2026-09-21-notification-preferences-and-delivery-channels-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/docs/superpowers/specs/2026-09-21-notification-preferences-and-delivery-channels-design.md)

## Global Constraints

- Protected branch constraint (`GH013`): All branch changes must be performed in an isolated git worktree (`.worktrees/feat-notification-preferences-delivery`), and merged via pull request.
- Database migrations: PostgreSQL migration SQL script MUST start with `SET LOCAL lock_timeout = '3s';`.
- Node.js engine compatibility: `>=22 <23`.
- External provider resilience: Outages, network errors, or timeouts in email dispatch MUST NOT cause business transactions (flight status updates, booking, cancellations) to fail or roll back.
- Staff security: All `/admin` routes and staff audit actions require `hasVerifiedStaffAccess`.
- Accessibility: Preference toggles must use `role="switch"`, `aria-checked`, and accessible labelling.

---

### Task 1: Database Schema & Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260921150000_notification_preferences_delivery/migration.sql`
- Create: `__tests__/database/notificationPreferences.database.test.ts`

**Interfaces:**
- Produces:
  - Enums: `NotificationChannel` (`IN_APP`, `EMAIL`), `NotificationCategory` (`FLIGHT_STATUS`, `ACCOUNT_ACTIVITY`, `TRAVEL_GUIDES`), `NotificationDeliveryStatus` (`PENDING`, `SENT`, `FAILED`).
  - Models: `NotificationPreference` with `@@unique([userId, category, channel])`, `NotificationDelivery` with relations to `Notification`.
  - Updated `Notification` model with `category` field.
  - Updated `User` model with `notificationPreferences` relation.

- [ ] **Step 1: Write failing database test**

Create `__tests__/database/notificationPreferences.database.test.ts`:
```ts
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'node:crypto';

describe('Notification Preferences & Deliveries Database Constraints', () => {
    let testUserId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                name: 'Test Preference User',
                email: `test-pref-${randomUUID()}@example.com`,
            },
        });
        testUserId = user.id;
    });

    afterAll(async () => {
        await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    });

    it('enforces unique constraint on (userId, category, channel)', async () => {
        await (prisma as any).notificationPreference.create({
            data: {
                userId: testUserId,
                category: 'FLIGHT_STATUS',
                channel: 'EMAIL',
                enabled: true,
            },
        });

        await expect(
            (prisma as any).notificationPreference.create({
                data: {
                    userId: testUserId,
                    category: 'FLIGHT_STATUS',
                    channel: 'EMAIL',
                    enabled: false,
                },
            })
        ).rejects.toThrow();
    });

    it('cascades deletion of preferences and deliveries when user is deleted', async () => {
        const tempUser = await prisma.user.create({
            data: {
                name: 'Temp Cascade User',
                email: `temp-${randomUUID()}@example.com`,
            },
        });

        const pref = await (prisma as any).notificationPreference.create({
            data: {
                userId: tempUser.id,
                category: 'ACCOUNT_ACTIVITY',
                channel: 'IN_APP',
                enabled: true,
            },
        });

        const notif = await prisma.notification.create({
            data: {
                userId: tempUser.id,
                title: 'Cascade Test',
                message: 'Will be deleted',
                type: 'SYSTEM',
                category: 'ACCOUNT_ACTIVITY',
            } as any,
        });

        const delivery = await (prisma as any).notificationDelivery.create({
            data: {
                notificationId: notif.id,
                channel: 'IN_APP',
                status: 'SENT',
                recipient: tempUser.id,
            },
        });

        await prisma.user.delete({ where: { id: tempUser.id } });

        const prefAfter = await (prisma as any).notificationPreference.findUnique({ where: { id: pref.id } });
        const notifAfter = await prisma.notification.findUnique({ where: { id: notif.id } });
        const deliveryAfter = await (prisma as any).notificationDelivery.findUnique({ where: { id: delivery.id } });

        expect(prefAfter).toBeNull();
        expect(notifAfter).toBeNull();
        expect(deliveryAfter).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/database/notificationPreferences.database.test.ts`  
Expected: FAIL (models and tables do not exist yet).

- [ ] **Step 3: Update `prisma/schema.prisma` and create migration**

Add enums and models to `prisma/schema.prisma`:
```prisma
enum NotificationChannel {
  IN_APP
  EMAIL
}

enum NotificationCategory {
  FLIGHT_STATUS
  ACCOUNT_ACTIVITY
  TRAVEL_GUIDES
}

enum NotificationDeliveryStatus {
  PENDING
  SENT
  FAILED
}

model NotificationPreference {
  id        String               @id @default(cuid())
  userId    String
  user      User                 @relation("UserNotificationPreferences", fields: [userId], references: [id], onDelete: Cascade)
  category  NotificationCategory
  channel   NotificationChannel
  enabled   Boolean
  createdAt DateTime             @default(now())
  updatedAt DateTime             @default(now()) @updatedAt

  @@unique([userId, category, channel])
  @@index([userId])
}

model Notification {
  id          String                 @id @default(cuid())
  userId      String
  user        User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  title       String
  message     String
  type        String
  category    NotificationCategory   @default(FLIGHT_STATUS)
  isRead      Boolean                @default(false)
  createdAt   DateTime               @default(now())
  deliveries  NotificationDelivery[]

  @@index([userId, isRead])
  @@index([userId, createdAt])
}

model NotificationDelivery {
  id             String                     @id @default(cuid())
  notificationId String
  notification   Notification               @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  channel        NotificationChannel
  status         NotificationDeliveryStatus @default(PENDING)
  recipient      String
  error          String?                    @db.Text
  attempts       Int                        @default(0)
  lastAttemptAt  DateTime?
  sentAt         DateTime?
  createdAt      DateTime                   @default(now())

  @@index([status, channel])
  @@index([notificationId])
  @@index([createdAt])
}
```

Create migration directory `prisma/migrations/20260921150000_notification_preferences_delivery/migration.sql`:
```sql
SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');
CREATE TYPE "NotificationCategory" AS ENUM ('FLIGHT_STATUS', 'ACCOUNT_ACTIVITY', 'TRAVEL_GUIDES');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable Notification
ALTER TABLE "Notification" ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'FLIGHT_STATUS';

-- Backfill categories from type
UPDATE "Notification" SET "category" = 'FLIGHT_STATUS' WHERE "type" = 'FLIGHT_STATUS';
UPDATE "Notification" SET "category" = 'ACCOUNT_ACTIVITY' WHERE "type" IN ('POINTS', 'SYSTEM');

-- CreateTable NotificationPreference
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable NotificationDelivery
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_channel_key" ON "NotificationPreference"("userId", "category", "channel");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE INDEX "NotificationDelivery_status_channel_idx" ON "NotificationDelivery"("status", "channel");
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");
CREATE INDEX "NotificationDelivery_createdAt_idx" ON "NotificationDelivery"("createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Run: `npx prisma migrate deploy && npx prisma generate`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/database/notificationPreferences.database.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add prisma/schema.prisma prisma/migrations/20260921150000_notification_preferences_delivery/migration.sql __tests__/database/notificationPreferences.database.test.ts
git commit -m "feat(schema): add notification preference and delivery models (#82)"
```

---

### Task 2: Domain Services & Email Delivery Adapter

**Files:**
- Create: `lib/notificationEmail.ts`
- Create: `lib/notificationService.ts`
- Modify: `lib/validation.ts`
- Create: `__tests__/lib/notificationService.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_NOTIFICATION_PREFERENCES`: Default channel settings for each category.
  - `NotificationService.getEffectivePreferences(userId)`: Resolves full preference matrix with defaults.
  - `NotificationService.updatePreferences(userId, updates)`: Upserts preferences.
  - `NotificationService.dispatchNotification({ userId, title, message, category, type? })`: Resilient multi-channel delivery.
  - `NotificationService.retryDelivery(deliveryId)`: Re-dispatches failed email delivery.
  - `sendNotificationEmail(...)`: Mailpit / Postmark delivery adapter.

- [ ] **Step 1: Write failing unit tests**

Create `__tests__/lib/notificationService.test.ts`:
```ts
import { NotificationService, DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/notificationService';
import { prisma } from '@/lib/prisma';
import * as notificationEmail from '@/lib/notificationEmail';

jest.mock('@/lib/notificationEmail');

describe('NotificationService', () => {
    let service: NotificationService;

    beforeEach(() => {
        service = new NotificationService();
        jest.clearAllMocks();
    });

    describe('getEffectivePreferences', () => {
        it('returns default preferences when user has no stored rows', async () => {
            jest.spyOn(prisma.notificationPreference, 'findMany').mockResolvedValue([]);
            const result = await service.getEffectivePreferences('user-1');
            expect(result).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
        });

        it('merges stored user preferences over default preferences', async () => {
            jest.spyOn(prisma.notificationPreference, 'findMany').mockResolvedValue([
                {
                    id: 'pref-1',
                    userId: 'user-1',
                    category: 'TRAVEL_GUIDES',
                    channel: 'EMAIL',
                    enabled: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ] as any);

            const result = await service.getEffectivePreferences('user-1');
            expect(result.TRAVEL_GUIDES.EMAIL).toBe(true);
            expect(result.FLIGHT_STATUS.EMAIL).toBe(true);
        });
    });

    describe('dispatchNotification', () => {
        it('creates in-app notification and delivery when IN_APP is enabled', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: false },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-1', userId: 'user-1', title: 'Test', message: 'Hello' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create').mockResolvedValue({ id: 'del-1' } as any);

            await service.dispatchNotification({
                userId: 'user-1',
                title: 'Test',
                message: 'Hello',
                category: 'FLIGHT_STATUS',
            });

            expect(prisma.notification.create).toHaveBeenCalled();
            expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    notificationId: 'notif-1',
                    channel: 'IN_APP',
                    status: 'SENT',
                }),
            });
            expect(notificationEmail.sendNotificationEmail).not.toHaveBeenCalled();
        });

        it('dispatches email and marks FAILED when provider throws without bubbling error', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-1', userId: 'user-1', title: 'Flight Cancelled', message: 'Sorry' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create')
                .mockResolvedValueOnce({ id: 'del-inapp' } as any)
                .mockResolvedValueOnce({ id: 'del-email' } as any);
            jest.spyOn(prisma.notificationDelivery, 'update').mockResolvedValue({} as any);

            (notificationEmail.sendNotificationEmail as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

            // Must NOT throw
            await expect(
                service.dispatchNotification({
                    userId: 'user-1',
                    title: 'Flight Cancelled',
                    message: 'Sorry',
                    category: 'FLIGHT_STATUS',
                })
            ).resolves.not.toThrow();

            expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
                where: { id: 'del-email' },
                data: expect.objectContaining({
                    status: 'FAILED',
                    error: 'Connection timeout',
                    attempts: 1,
                }),
            });
        });
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/lib/notificationService.test.ts`  
Expected: FAIL (modules not implemented).

- [ ] **Step 3: Implement `lib/notificationEmail.ts`, `lib/validation.ts`, and `lib/notificationService.ts`**

Implement `lib/notificationEmail.ts`:
```ts
type EmailProvider = 'mailpit' | 'postmark';

function requireSetting(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing email setting: ${name}`);
    return value;
}

function provider(): EmailProvider {
    const value = process.env.AUTH_EMAIL_PROVIDER?.trim() || 'mailpit';
    if (value !== 'mailpit' && value !== 'postmark') {
        throw new Error('AUTH_EMAIL_PROVIDER must be mailpit or postmark');
    }
    return value;
}

function mailpitSender(value: string): { Email: string; Name?: string } {
    const namedAddress = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    if (namedAddress) {
        return {
            Email: namedAddress[2].trim(),
            ...(namedAddress[1].trim() ? { Name: namedAddress[1].trim() } : {}),
        };
    }
    return { Email: value };
}

export interface NotificationEmailInput {
    to: string;
    title: string;
    message: string;
}

export async function sendNotificationEmail(input: NotificationEmailInput): Promise<void> {
    const selectedProvider = provider();
    const endpoint = requireSetting('AUTH_EMAIL_API_URL');
    const sender = process.env.AUTH_EMAIL_FROM?.trim() || 'Mona Airways <no-reply@localhost>';
    const appUrl = process.env.NEXTAUTH_URL?.trim() || 'http://localhost:3000';

    const subject = `Mona Airways: ${input.title}`;
    const textBody = [
        input.title,
        '',
        input.message,
        '',
        '---',
        `Manage your notification preferences at: ${appUrl}/profile/notifications`,
    ].join('\n');

    if (selectedProvider === 'mailpit') {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                From: mailpitSender(sender),
                To: [{ Email: input.to }],
                Subject: subject,
                Text: textBody,
            }),
        });
        if (!response.ok) {
            throw new Error(`Mailpit delivery failed with HTTP ${response.status}`);
        }
        return;
    }

    if (selectedProvider === 'postmark') {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': requireSetting('AUTH_EMAIL_POSTMARK_SERVER_TOKEN'),
            },
            body: JSON.stringify({
                From: sender,
                To: input.to,
                Subject: subject,
                TextBody: textBody,
                MessageStream: 'outbound',
            }),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Postmark delivery failed with HTTP ${response.status}: ${body}`);
        }
    }
}
```

In `lib/validation.ts`, add:
```ts
export const notificationCategoryEnum = z.enum(['FLIGHT_STATUS', 'ACCOUNT_ACTIVITY', 'TRAVEL_GUIDES']);
export const notificationChannelEnum = z.enum(['IN_APP', 'EMAIL']);
export const notificationDeliveryStatusEnum = z.enum(['PENDING', 'SENT', 'FAILED']);

export const notificationPreferenceItemSchema = z.object({
    category: notificationCategoryEnum,
    channel: notificationChannelEnum,
    enabled: z.boolean(),
});

export const updateNotificationPreferencesSchema = z.array(notificationPreferenceItemSchema).min(1);

export const adminNotificationDeliveriesQuerySchema = z.object({
    status: notificationDeliveryStatusEnum.optional(),
    channel: notificationChannelEnum.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().optional(),
});
```

Create `lib/notificationService.ts` implementing `NotificationService`:
```ts
import { prisma } from './prisma';
import { logger } from './logger';
import { sendNotificationEmail } from './notificationEmail';
import type {
    NotificationCategory,
    NotificationChannel,
    NotificationDeliveryStatus,
} from '@prisma/client';

export type EffectivePreferences = Record<NotificationCategory, Record<NotificationChannel, boolean>>;

export const DEFAULT_NOTIFICATION_PREFERENCES: EffectivePreferences = {
    FLIGHT_STATUS: {
        IN_APP: true,
        EMAIL: true,
    },
    ACCOUNT_ACTIVITY: {
        IN_APP: true,
        EMAIL: true,
    },
    TRAVEL_GUIDES: {
        IN_APP: true,
        EMAIL: false,
    },
};

export class NotificationService {
    async getEffectivePreferences(userId: string): Promise<EffectivePreferences> {
        const stored = await prisma.notificationPreference.findMany({
            where: { userId },
        });

        const effective: EffectivePreferences = {
            FLIGHT_STATUS: { ...DEFAULT_NOTIFICATION_PREFERENCES.FLIGHT_STATUS },
            ACCOUNT_ACTIVITY: { ...DEFAULT_NOTIFICATION_PREFERENCES.ACCOUNT_ACTIVITY },
            TRAVEL_GUIDES: { ...DEFAULT_NOTIFICATION_PREFERENCES.TRAVEL_GUIDES },
        };

        for (const pref of stored) {
            if (effective[pref.category]) {
                effective[pref.category][pref.channel] = pref.enabled;
            }
        }

        return effective;
    }

    async updatePreferences(
        userId: string,
        updates: Array<{ category: NotificationCategory; channel: NotificationChannel; enabled: boolean }>
    ): Promise<void> {
        await prisma.$transaction(
            updates.map(u =>
                prisma.notificationPreference.upsert({
                    where: {
                        userId_category_channel: {
                            userId,
                            category: u.category,
                            channel: u.channel,
                        },
                    },
                    create: {
                        userId,
                        category: u.category,
                        channel: u.channel,
                        enabled: u.enabled,
                    },
                    update: {
                        enabled: u.enabled,
                    },
                })
            )
        );
    }

    async dispatchNotification(input: {
        userId: string;
        title: string;
        message: string;
        category: NotificationCategory;
        type?: string;
    }): Promise<void> {
        const [user, preferences] = await Promise.all([
            prisma.user.findUnique({
                where: { id: input.userId },
                select: { id: true, email: true },
            }),
            this.getEffectivePreferences(input.userId),
        ]);

        if (!user) return;

        const categoryPref = preferences[input.category] || DEFAULT_NOTIFICATION_PREFERENCES[input.category];
        let notificationId: string | null = null;

        // 1. In-App delivery
        if (categoryPref.IN_APP) {
            const notif = await prisma.notification.create({
                data: {
                    userId: user.id,
                    title: input.title,
                    message: input.message,
                    category: input.category,
                    type: input.type || input.category,
                },
            });
            notificationId = notif.id;

            await prisma.notificationDelivery.create({
                data: {
                    notificationId: notif.id,
                    channel: 'IN_APP',
                    status: 'SENT',
                    recipient: user.id,
                    sentAt: new Date(),
                    attempts: 1,
                },
            });
        }

        // 2. Email delivery
        if (categoryPref.EMAIL && user.email) {
            if (!notificationId) {
                const notif = await prisma.notification.create({
                    data: {
                        userId: user.id,
                        title: input.title,
                        message: input.message,
                        category: input.category,
                        type: input.type || input.category,
                        isRead: true, // If only delivered by email, mark read in drawer
                    },
                });
                notificationId = notif.id;
            }

            const delivery = await prisma.notificationDelivery.create({
                data: {
                    notificationId,
                    channel: 'EMAIL',
                    status: 'PENDING',
                    recipient: user.email,
                },
            });

            try {
                await sendNotificationEmail({
                    to: user.email,
                    title: input.title,
                    message: input.message,
                });

                await prisma.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: 'SENT',
                        sentAt: new Date(),
                        attempts: 1,
                        lastAttemptAt: new Date(),
                    },
                });
            } catch (error) {
                const errMessage = error instanceof Error ? error.message : 'Unknown email dispatch error';
                logger.warn(`Failed to dispatch notification email to ${user.email}: ${errMessage}`, {
                    deliveryId: delivery.id,
                    error: errMessage,
                });

                await prisma.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: 'FAILED',
                        error: errMessage,
                        attempts: 1,
                        lastAttemptAt: new Date(),
                    },
                });
            }
        }
    }

    async retryDelivery(deliveryId: string): Promise<void> {
        const delivery = await prisma.notificationDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
            include: { notification: true },
        });

        if (delivery.channel !== 'EMAIL') {
            throw new Error('Only email deliveries can be retried.');
        }

        try {
            await sendNotificationEmail({
                to: delivery.recipient,
                title: delivery.notification.title,
                message: delivery.notification.message,
            });

            await prisma.notificationDelivery.update({
                where: { id: deliveryId },
                data: {
                    status: 'SENT',
                    sentAt: new Date(),
                    attempts: { increment: 1 },
                    lastAttemptAt: new Date(),
                    error: null,
                },
            });
        } catch (error) {
            const errMessage = error instanceof Error ? error.message : 'Retry email dispatch failed';
            await prisma.notificationDelivery.update({
                where: { id: deliveryId },
                data: {
                    status: 'FAILED',
                    error: errMessage,
                    attempts: { increment: 1 },
                    lastAttemptAt: new Date(),
                },
            });
            throw error;
        }
    }
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx jest __tests__/lib/notificationService.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add lib/notificationEmail.ts lib/validation.ts lib/notificationService.ts __tests__/lib/notificationService.test.ts
git commit -m "feat(service): add notification domain service and email delivery adapter (#82)"
```

---

### Task 3: Typed Server Actions & Event Integration

**Files:**
- Create: `app/actions/notificationActions.ts`
- Modify: `app/actions.ts`
- Create: `__tests__/actions/notificationActions.test.ts`
- Modify: `__tests__/app/actions.test.ts`

**Interfaces:**
- Produces:
  - `getNotificationPreferencesAction()`
  - `updateNotificationPreferencesAction(input)`
  - `getAdminNotificationDeliveriesAction(input)`
  - `retryNotificationDeliveryAction(input)`
- Modifies:
  - `updateFlightStatusAction`: uses `notificationService.dispatchNotification` with `category: 'FLIGHT_STATUS'`.
  - Booking confirmation & cancellation: uses `category: 'ACCOUNT_ACTIVITY'`.

- [ ] **Step 1: Write failing action tests**

Create `__tests__/actions/notificationActions.test.ts`:
```ts
import {
    getNotificationPreferencesAction,
    updateNotificationPreferencesAction,
    getAdminNotificationDeliveriesAction,
    retryNotificationDeliveryAction,
} from '@/app/actions/notificationActions';
import { getServerSession } from 'next-auth';
import { hasVerifiedStaffAccess } from '@/lib/staffMfa';

jest.mock('next-auth');
jest.mock('@/lib/staffMfa');

describe('Notification Server Actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects unauthenticated traveler from getting preferences', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        const result = await getNotificationPreferencesAction();
        expect(result).toEqual(expect.objectContaining({ ok: false }));
    });

    it('rejects non-staff user from accessing admin delivery logs', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
        (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(false);

        const result = await getAdminNotificationDeliveriesAction({});
        expect(result).toEqual(expect.objectContaining({ ok: false }));
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/actions/notificationActions.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement `app/actions/notificationActions.ts` and update `app/actions.ts`**

Implement `app/actions/notificationActions.ts` with input validation, session checks, and `ActionResult` returns.  
Update `app/actions.ts` in `updateFlightStatusAction`, booking checkout, and booking cancellation to dispatch via `new NotificationService().dispatchNotification(...)`.

- [ ] **Step 4: Run action tests and existing actions tests**

Run: `npx jest __tests__/actions/notificationActions.test.ts && npx jest __tests__/app/actions.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add app/actions/notificationActions.ts app/actions.ts __tests__/actions/notificationActions.test.ts __tests__/app/actions.test.ts
git commit -m "feat(actions): add notification server actions and integrate domain events (#82)"
```

---

### Task 4: Traveler Notification Preferences UI

**Files:**
- Create: `app/profile/notifications/page.tsx`
- Create: `components/profile/NotificationPreferencesClient.tsx`
- Modify: `components/ui/ProfileClient.tsx`
- Modify: `components/ui/titlebar.tsx`
- Create: `__tests__/components/NotificationPreferencesClient.test.tsx`

**Interfaces:**
- Produces:
  - Route: `/profile/notifications`
  - Component: `NotificationPreferencesClient` with accessible switch toggles (`role="switch"`, `aria-checked`).
  - Navigation: Profile sidebar link and titlebar notification drawer settings button.

- [ ] **Step 1: Write failing UI component test**

Create `__tests__/components/NotificationPreferencesClient.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationPreferencesClient from '@/components/profile/NotificationPreferencesClient';
import * as actions from '@/app/actions/notificationActions';

jest.mock('@/app/actions/notificationActions');

describe('NotificationPreferencesClient', () => {
    const initialPreferences = {
        FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
        ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
        TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders category rows and channel toggles', () => {
        render(
            <NotificationPreferencesClient
                userEmail="alex@example.com"
                initialPreferences={initialPreferences}
            />
        );

        expect(screen.getByText(/Flight Status/i)).toBeInTheDocument();
        expect(screen.getByText(/Account & Bookings/i)).toBeInTheDocument();
        expect(screen.getByText(/Travel Guides & Tips/i)).toBeInTheDocument();

        const switches = screen.getAllByRole('switch');
        expect(switches.length).toBe(6);
    });

    it('triggers action on toggle and displays success status', async () => {
        (actions.updateNotificationPreferencesAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { success: true },
        });

        render(
            <NotificationPreferencesClient
                userEmail="alex@example.com"
                initialPreferences={initialPreferences}
            />
        );

        const emailGuideToggle = screen.getByLabelText(/Travel Guides & Tips Email/i);
        expect(emailGuideToggle).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(emailGuideToggle);

        await waitFor(() => {
            expect(actions.updateNotificationPreferencesAction).toHaveBeenCalled();
            expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
        });
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/components/NotificationPreferencesClient.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement client component, page route, and navigation links**

Implement:
- `components/profile/NotificationPreferencesClient.tsx`
- `app/profile/notifications/page.tsx`
- Link in `components/ui/ProfileClient.tsx` (sidebar)
- Settings icon in `components/ui/titlebar.tsx` (drawer header)

- [ ] **Step 4: Run component tests to verify pass**

Run: `npx jest __tests__/components/NotificationPreferencesClient.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add app/profile/notifications/page.tsx components/profile/NotificationPreferencesClient.tsx components/ui/ProfileClient.tsx components/ui/titlebar.tsx __tests__/components/NotificationPreferencesClient.test.tsx
git commit -m "feat(ui): add traveler notification preferences page and navigation (#82)"
```

---

### Task 5: Staff Notification Delivery Portal

**Files:**
- Create: `app/admin/notifications/page.tsx`
- Create: `components/admin/AdminNotificationDeliveriesClient.tsx`
- Modify: `app/admin/page.tsx`
- Create: `__tests__/admin/AdminNotificationDeliveriesClient.test.tsx`

**Interfaces:**
- Produces:
  - Route: `/admin/notifications`
  - Client component: `AdminNotificationDeliveriesClient` with filterable tabs, error inspector, and one-click retry.
  - Quick-access card on `/admin` dashboard.

- [ ] **Step 1: Write failing admin portal test**

Create `__tests__/admin/AdminNotificationDeliveriesClient.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminNotificationDeliveriesClient from '@/components/admin/AdminNotificationDeliveriesClient';
import * as actions from '@/app/actions/notificationActions';

jest.mock('@/app/actions/notificationActions');

describe('AdminNotificationDeliveriesClient', () => {
    const mockDeliveries = [
        {
            id: 'del-1',
            channel: 'EMAIL',
            status: 'FAILED',
            recipient: 'traveler@example.com',
            error: 'SMTP Timeout 504',
            attempts: 1,
            createdAt: new Date().toISOString(),
            notification: {
                title: 'Flight Delayed',
                message: 'Your flight is delayed by 45 mins.',
                category: 'FLIGHT_STATUS',
            },
        },
    ];

    it('renders delivery records and handles retry click', async () => {
        (actions.retryNotificationDeliveryAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { success: true },
        });

        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={1}
            />
        );

        expect(screen.getByText('traveler@example.com')).toBeInTheDocument();
        expect(screen.getByText('SMTP Timeout 504')).toBeInTheDocument();

        const retryButton = screen.getByRole('button', { name: /Retry/i });
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(actions.retryNotificationDeliveryAction).toHaveBeenCalledWith('del-1');
        });
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/admin/AdminNotificationDeliveriesClient.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement admin portal page and client component**

Implement:
- `components/admin/AdminNotificationDeliveriesClient.tsx`
- `app/admin/notifications/page.tsx`
- Dashboard card in `app/admin/page.tsx`

- [ ] **Step 4: Run admin tests to verify pass**

Run: `npx jest __tests__/admin/AdminNotificationDeliveriesClient.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add app/admin/notifications/page.tsx components/admin/AdminNotificationDeliveriesClient.tsx app/admin/page.tsx __tests__/admin/AdminNotificationDeliveriesClient.test.tsx
git commit -m "feat(admin): add notification delivery audit portal and retry control (#82)"
```

---

### Task 6: Privacy (GDPR) Integration & Full Verification

**Files:**
- Modify: `lib/privacyService.ts`
- Modify: `__tests__/lib/privacyService.test.ts`
- Modify: `__tests__/lib/privacyService.database.test.ts`

**Interfaces:**
- Produces:
  - Privacy data export includes `notificationPreferences` and `notificationDeliveries`.
  - Account deletion verifies clean cascade removal of all notification preference and delivery rows.

- [ ] **Step 1: Write failing test in privacy service**

Update `__tests__/lib/privacyService.test.ts` to assert that exported JSON includes `notificationPreferences`.

- [ ] **Step 2: Run privacy tests to verify failure**

Run: `npx jest __tests__/lib/privacyService.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Update `lib/privacyService.ts`**

Include `notificationPreferences` in `generatePersonalDataExport`.

- [ ] **Step 4: Run privacy tests to verify pass**

Run: `npx jest __tests__/lib/privacyService.test.ts && npx jest __tests__/lib/privacyService.database.test.ts`  
Expected: PASS.

- [ ] **Step 5: Run full project verification**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:database
```
Verify: 0 TypeScript errors, 0 lint warnings, all test suites pass.

- [ ] **Step 6: Commit changes**

```bash
git add lib/privacyService.ts __tests__/lib/privacyService.test.ts __tests__/lib/privacyService.database.test.ts
git commit -m "feat(privacy): include notification preferences and delivery logs in gdpr export (#82)"
```
