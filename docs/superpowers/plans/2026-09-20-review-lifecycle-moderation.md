# Review Lifecycle, Reporting, and Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement review validation, author editing, user reporting with threshold-based auto-concealment, an auditable admin moderation portal, and public query boundaries for travel guide reviews.

**Architecture:** Extend Prisma schema with review statuses, user reports, and moderation audit history with foreign keys and unique constraints. Encapsulate domain logic in a dedicated moderation service (`lib/reviewModerationService.ts`) with structured logging. Expose typed server actions (`ActionResult<T>`) and update the travel guide, profile, and admin dashboard UIs.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma ORM, PostgreSQL, Zod, NextAuth.js, Jest, Testing Library.

**Spec:** [`docs/superpowers/specs/2026-09-20-review-lifecycle-moderation-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/docs/superpowers/specs/2026-09-20-review-lifecycle-moderation-design.md)

## Global Constraints

- Protected branch constraint (`GH013`): All branch merges to `main` must proceed through pull requests with squash-merging.
- PostgreSQL migration scripts in `prisma/migrations/` MUST start with `SET LOCAL lock_timeout = '3s';`.
- Single review per user per city guide (`@@unique([userId, cityGuideId])`).
- Single report per user per review (`@@unique([reviewId, reporterId])`).
- Report auto-concealment threshold: $\ge 3$ active pending reports transitions review to `HIDDEN`.
- Staff moderation actions strictly gated by `hasVerifiedStaffAccess`.
- Moderation actions and automated threshold transitions must record durable audit trail in `ReviewModerationAudit`.
- Node.js engine compatibility: `>=22 <23`.

---

### Task 1: Database Schema & Migrations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260920230000_review_lifecycle_moderation/migration.sql`
- Create: `__tests__/database/reviewModeration.test.ts`

**Interfaces:**
- Produces:
  - Enums: `ReviewStatus` (`APPROVED`, `PENDING_MODERATION`, `HIDDEN`), `ReviewReportReason` (`SPAM`, `OFFENSIVE`, `HARASSMENT`, `MISINFORMATION`, `OTHER`), `ReportStatus` (`PENDING`, `RESOLVED`, `DISMISSED`), `ModerationAction` (`APPROVE`, `HIDE`, `DISMISS_REPORTS`, `DELETE`)
  - Models: `ReviewReport`, `ReviewModerationAudit`, updated `Review` (with `status`, `updatedAt`, `reports`, `moderationAudits`, unique index on `[userId, cityGuideId]`), updated `User` relations

- [ ] **Step 1: Write database integration test verifying schema requirements**

Create `__tests__/database/reviewModeration.test.ts`:
```ts
import { prisma } from '@/lib/prisma';

describe('Review Moderation Database Schema', () => {
    const testEmail = `test-mod-${Date.now()}@example.com`;
    let testUserId: string;
    let cityGuideId: number;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: testEmail,
                name: 'Test Reviewer',
            },
        });
        testUserId = user.id;

        const city = await prisma.cityGuide.create({
            data: {
                city: `TestCity-${Date.now()}`,
                country: 'TestCountry',
                description: 'A test city for review moderation tests',
                attractions: ['Park', 'Museum'],
            },
        });
        cityGuideId = city.id;
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { email: testEmail } });
        if (cityGuideId) {
            await prisma.cityGuide.deleteMany({ where: { id: cityGuideId } });
        }
    });

    it('creates review with default APPROVED status and updatedAt timestamp', async () => {
        const review = await prisma.review.create({
            data: {
                userId: testUserId,
                cityGuideId,
                rating: 5,
                content: 'Spectacular city with scenic views and great food.',
            },
        });

        expect(review.status).toBe('APPROVED');
        expect(review.updatedAt).toBeDefined();

        await prisma.review.delete({ where: { id: review.id } });
    });

    it('enforces one review per user per city guide', async () => {
        const review1 = await prisma.review.create({
            data: {
                userId: testUserId,
                cityGuideId,
                rating: 4,
                content: 'First review of this wonderful destination.',
            },
        });

        await expect(
            prisma.review.create({
                data: {
                    userId: testUserId,
                    cityGuideId,
                    rating: 2,
                    content: 'Attempted duplicate review for the same city.',
                },
            })
        ).rejects.toThrow();

        await prisma.review.delete({ where: { id: review1.id } });
    });

    it('enforces one report per user per review and links correctly', async () => {
        const review = await prisma.review.create({
            data: {
                userId: testUserId,
                cityGuideId,
                rating: 1,
                content: 'Review that will receive a report test.',
            },
        });

        const reporter = await prisma.user.create({
            data: {
                email: `reporter-${Date.now()}@example.com`,
                name: 'Reporter User',
            },
        });

        const report = await prisma.reviewReport.create({
            data: {
                reviewId: review.id,
                reporterId: reporter.id,
                reason: 'SPAM',
                details: 'Commercial solicitation content.',
            },
        });

        expect(report.status).toBe('PENDING');

        // Duplicate report from same reporter should fail
        await expect(
            prisma.reviewReport.create({
                data: {
                    reviewId: review.id,
                    reporterId: reporter.id,
                    reason: 'OFFENSIVE',
                },
            })
        ).rejects.toThrow();

        // Audit log creation with SetNull on review delete
        const audit = await prisma.reviewModerationAudit.create({
            data: {
                reviewId: review.id,
                moderatorId: reporter.id,
                action: 'HIDE',
                reason: 'Violated content guidelines',
            },
        });

        expect(audit.action).toBe('HIDE');

        // Deleting review cascades to reports and sets reviewId to null on audit
        await prisma.review.delete({ where: { id: review.id } });

        const reloadedAudit = await prisma.reviewModerationAudit.findUnique({
            where: { id: audit.id },
        });
        expect(reloadedAudit?.reviewId).toBeNull();

        await prisma.reviewModerationAudit.delete({ where: { id: audit.id } });
        await prisma.user.delete({ where: { id: reporter.id } });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/database/reviewModeration.test.ts`
Expected: FAIL with schema errors (fields `status`, `updatedAt`, models `ReviewReport`, `ReviewModerationAudit` do not exist).

- [ ] **Step 3: Update `prisma/schema.prisma` and create migration**

Update `prisma/schema.prisma` with:
- Enums: `ReviewStatus`, `ReviewReportReason`, `ReportStatus`, `ModerationAction`.
- Updated `Review` model with `status ReviewStatus @default(APPROVED)`, `updatedAt DateTime @default(now()) @updatedAt`, `reports ReviewReport[]`, `moderationAudits ReviewModerationAudit[]`, `@@unique([userId, cityGuideId])`, `@@index([cityGuideId, status])`, and `@@index([status])`.
- New `ReviewReport` model with `@@unique([reviewId, reporterId])`, `@@index([reviewId, status])`, `@@index([status])`.
- New `ReviewModerationAudit` model with `@@index([reviewId])`, `@@index([moderatorId])`, `@@index([createdAt])`.
- Updated `User` model relations: `reviewReports ReviewReport[] @relation("UserReviewReports")` and `moderationAudits ReviewModerationAudit[] @relation("ModeratorAudits")`.

Create migration directory `prisma/migrations/20260920230000_review_lifecycle_moderation/migration.sql`:
```sql
SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('APPROVED', 'PENDING_MODERATION', 'HIDDEN');
CREATE TYPE "ReviewReportReason" AS ENUM ('SPAM', 'OFFENSIVE', 'HARASSMENT', 'MISINFORMATION', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ModerationAction" AS ENUM ('APPROVE', 'HIDE', 'DISMISS_REPORTS', 'DELETE');

-- Deduplicate existing legacy reviews keeping the most recently created
DELETE FROM "Review" r1
USING "Review" r2
WHERE r1."userId" = r2."userId"
  AND r1."cityGuideId" = r2."cityGuideId"
  AND r1."createdAt" < r2."createdAt";

-- AlterTable
ALTER TABLE "Review"
  ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable ReviewReport
CREATE TABLE "ReviewReport" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReviewReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable ReviewModerationAudit
CREATE TABLE "ReviewModerationAudit" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT,
    "moderatorId" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewModerationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_cityGuideId_key" ON "Review"("userId", "cityGuideId");
CREATE INDEX "Review_cityGuideId_status_idx" ON "Review"("cityGuideId", "status");
CREATE INDEX "Review_status_idx" ON "Review"("status");

CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterId_key" ON "ReviewReport"("reviewId", "reporterId");
CREATE INDEX "ReviewReport_reviewId_status_idx" ON "ReviewReport"("reviewId", "status");
CREATE INDEX "ReviewReport_status_idx" ON "ReviewReport"("status");

CREATE INDEX "ReviewModerationAudit_reviewId_idx" ON "ReviewModerationAudit"("reviewId");
CREATE INDEX "ReviewModerationAudit_moderatorId_idx" ON "ReviewModerationAudit"("moderatorId");
CREATE INDEX "ReviewModerationAudit_createdAt_idx" ON "ReviewModerationAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewModerationAudit" ADD CONSTRAINT "ReviewModerationAudit_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewModerationAudit" ADD CONSTRAINT "ReviewModerationAudit_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Run migration and generate client:
`npx prisma migrate deploy && npx prisma generate`

- [ ] **Step 4: Run database tests to verify it passes**

Run: `npx jest __tests__/database/reviewModeration.test.ts`
Expected: PASS (all 3 test cases pass).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260920230000_review_lifecycle_moderation/migration.sql __tests__/database/reviewModeration.test.ts
git commit -m "feat(schema): add review lifecycle, reporting, and moderation models (#82)"
```

---

### Task 2: Input Validation & Review Moderation Domain Service

**Files:**
- Modify: `lib/validation.ts`
- Create: `lib/reviewModerationService.ts`
- Create: `__tests__/lib/reviewModerationService.test.ts`

**Interfaces:**
- Consumes: Prisma models (`Review`, `ReviewReport`, `ReviewModerationAudit`), `lib/logger.ts`
- Produces:
  - `reviewSchema`, `updateReviewSchema`, `reportReviewSchema`, `moderateReviewSchema`
  - `submitReview(userId: string, data: { cityGuideId: number; rating: number; content: string })`
  - `updateReview(userId: string, isStaff: boolean, data: { reviewId: string; rating: number; content: string })`
  - `reportReview(reporterId: string, data: { reviewId: string; reason: ReviewReportReason; details?: string })`
  - `moderateReview(moderatorId: string, data: { reviewId: string; action: ModerationAction; reason?: string })`
  - Domain error classes (`DuplicateReviewError`, `ReviewNotFoundError`, `CannotReportOwnReviewError`, `DuplicateReportError`, `UnauthorizedError`, `ForbiddenStaffError`)

- [ ] **Step 1: Write unit tests for validation and moderation domain service**

Create `__tests__/lib/reviewModerationService.test.ts`:
```ts
import {
    submitReview,
    updateReview,
    reportReview,
    moderateReview,
    DuplicateReviewError,
    ReviewNotFoundError,
    CannotReportOwnReviewError,
    DuplicateReportError,
    UnauthorizedError,
    REPORT_AUTO_HIDE_THRESHOLD,
} from '@/lib/reviewModerationService';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        review: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        reviewReport: {
            findUnique: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        reviewModerationAudit: {
            create: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

describe('Review Moderation Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('submitReview', () => {
        it('rejects duplicate review for the same user and city guide', async () => {
            (prisma.review.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-rev' });

            await expect(
                submitReview('user-1', { cityGuideId: 10, rating: 5, content: 'A truly magnificent place.' })
            ).rejects.toThrow(DuplicateReviewError);
        });

        it('creates review with APPROVED status when no existing review exists', async () => {
            (prisma.review.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.review.create as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
                cityGuideId: 10,
                rating: 5,
                content: 'A truly magnificent place.',
                status: 'APPROVED',
            });

            const result = await submitReview('user-1', {
                cityGuideId: 10,
                rating: 5,
                content: 'A truly magnificent place.',
            });

            expect(result.id).toBe('rev-1');
            expect(result.status).toBe('APPROVED');
        });
    });

    describe('updateReview', () => {
        it('throws ReviewNotFoundError when review does not exist', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

            await expect(
                updateReview('user-1', false, { reviewId: 'rev-none', rating: 4, content: 'Updated content here.' })
            ).rejects.toThrow(ReviewNotFoundError);
        });

        it('throws UnauthorizedError when non-author attempts to edit', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2', // different author
                status: 'APPROVED',
            });

            await expect(
                updateReview('user-1', false, { reviewId: 'rev-1', rating: 4, content: 'Updated content here.' })
            ).rejects.toThrow(UnauthorizedError);
        });

        it('resets status to PENDING_MODERATION if previously HIDDEN', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
                status: 'HIDDEN',
            });
            (prisma.review.update as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'PENDING_MODERATION',
            });

            const updated = await updateReview('user-1', false, {
                reviewId: 'rev-1',
                rating: 5,
                content: 'Completely rewritten polite review.',
            });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'PENDING_MODERATION' }),
                })
            );
            expect(updated.status).toBe('PENDING_MODERATION');
        });
    });

    describe('reportReview', () => {
        it('prevents authors from reporting their own review', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
            });

            await expect(
                reportReview('user-1', { reviewId: 'rev-1', reason: 'SPAM' })
            ).rejects.toThrow(CannotReportOwnReviewError);
        });

        it('prevents duplicate reports by the same user', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2',
            });
            (prisma.reviewReport.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-rep' });

            await expect(
                reportReview('user-1', { reviewId: 'rev-1', reason: 'SPAM' })
            ).rejects.toThrow(DuplicateReportError);
        });

        it('auto-conceals to HIDDEN when pending reports reach threshold', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2',
                status: 'APPROVED',
            });
            (prisma.reviewReport.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.reviewReport.create as jest.Mock).mockResolvedValue({ id: 'rep-3' });
            (prisma.reviewReport.count as jest.Mock).mockResolvedValue(REPORT_AUTO_HIDE_THRESHOLD);

            await reportReview('user-1', { reviewId: 'rev-1', reason: 'OFFENSIVE' });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'rev-1' },
                    data: expect.objectContaining({ status: 'HIDDEN' }),
                })
            );
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: 'rev-1',
                        action: 'HIDE',
                        reason: expect.stringContaining('Automated threshold'),
                    }),
                })
            );
        });
    });

    describe('moderateReview', () => {
        it('approves review and resolves pending reports', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'PENDING_MODERATION',
            });

            await moderateReview('mod-1', {
                reviewId: 'rev-1',
                action: 'APPROVE',
                reason: 'Appropriate content.',
            });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'rev-1' },
                    data: expect.objectContaining({ status: 'APPROVED' }),
                })
            );
            expect(prisma.reviewReport.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { reviewId: 'rev-1', status: 'PENDING' },
                    data: expect.objectContaining({ status: 'RESOLVED' }),
                })
            );
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalled();
        });

        it('deletes review and captures metadata in audit record', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                content: 'Violating content.',
                rating: 1,
                cityGuideId: 5,
                userId: 'spammer-1',
            });

            await moderateReview('mod-1', {
                reviewId: 'rev-1',
                action: 'DELETE',
                reason: 'Severe TOS violation.',
            });

            expect(prisma.review.delete).toHaveBeenCalledWith({ where: { id: 'rev-1' } });
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: null,
                        action: 'DELETE',
                        metadata: expect.objectContaining({
                            content: 'Violating content.',
                        }),
                    }),
                })
            );
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/reviewModerationService.test.ts`
Expected: FAIL with module `@/lib/reviewModerationService` not found.

- [ ] **Step 3: Implement validation schemas and reviewModerationService**

In `lib/validation.ts`:
- Update `reviewSchema` content to enforce `.min(10, 'Review must be at least 10 characters long.')`.
- Export `updateReviewSchema = z.object({ reviewId: stringIdSchema, rating: z.number().int().min(1).max(5), content: requiredText('Review', 2000).min(10) }).strict()`.
- Export `reportReviewSchema = z.object({ reviewId: stringIdSchema, reason: z.enum(['SPAM', 'OFFENSIVE', 'HARASSMENT', 'MISINFORMATION', 'OTHER']), details: z.string().trim().max(500).optional() }).strict()`.
- Export `moderateReviewSchema = z.object({ reviewId: stringIdSchema, action: z.enum(['APPROVE', 'HIDE', 'DISMISS_REPORTS', 'DELETE']), reason: z.string().trim().max(500).optional() }).strict()`.

In `lib/reviewModerationService.ts`:
- Implement error classes: `DuplicateReviewError`, `ReviewNotFoundError`, `CannotReportOwnReviewError`, `DuplicateReportError`, `UnauthorizedError`, `ForbiddenStaffError`.
- Implement `REPORT_AUTO_HIDE_THRESHOLD = 3`.
- Implement `submitReview`, `updateReview`, `reportReview`, and `moderateReview` adhering to transactions and emitting events with `lib/logger.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/reviewModerationService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation.ts lib/reviewModerationService.ts __tests__/lib/reviewModerationService.test.ts
git commit -m "feat(service): implement review moderation service and validation schemas (#82)"
```

---

### Task 3: Server Actions & Public Query Boundaries

**Files:**
- Create: `app/actions/reviewActions.ts`
- Modify: `app/actions.ts`
- Modify: `app/travelguide/page.tsx`
- Create: `__tests__/actions/reviewActions.test.ts`

**Interfaces:**
- Consumes: `lib/reviewModerationService.ts`, `lib/auth.ts`, `lib/validation.ts`
- Produces:
  - `submitCityGuideReviewAction`
  - `updateCityGuideReviewAction`
  - `reportCityGuideReviewAction`
  - `moderateReviewAction`
  - Updated `deleteReviewAction`
  - Filtered public city guide reviews query

- [ ] **Step 1: Write unit tests for server actions and authorization gating**

Create `__tests__/actions/reviewActions.test.ts`:
```ts
import {
    submitCityGuideReviewAction,
    updateCityGuideReviewAction,
    reportCityGuideReviewAction,
    moderateReviewAction,
} from '@/app/actions/reviewActions';
import * as moderationService from '@/lib/reviewModerationService';
import { getServerSession } from 'next-auth';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/reviewModerationService');
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

describe('Review Server Actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('submitCityGuideReviewAction', () => {
        it('returns validation failure when unauthenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await submitCityGuideReviewAction(1, 5, 'Great city to visit!');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/sign in/i);
            }
        });

        it('submits review successfully when authenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (moderationService.submitReview as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                rating: 5,
                content: 'Great city to visit!',
            });

            const result = await submitCityGuideReviewAction(1, 5, 'Great city to visit!');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.id).toBe('rev-1');
            }
        });
    });

    describe('moderateReviewAction', () => {
        it('returns unauthorized error for non-staff users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-1', role: 'TRAVELER' },
            });

            const result = await moderateReviewAction('rev-1', 'APPROVE');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/staff access required/i);
            }
        });

        it('executes moderation for verified staff members', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', mfaVerified: true },
            });
            (moderationService.moderateReview as jest.Mock).mockResolvedValue(undefined);

            const result = await moderateReviewAction('rev-1', 'APPROVE', 'Looks good');
            expect(result.ok).toBe(true);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/actions/reviewActions.test.ts`
Expected: FAIL with module `@/app/actions/reviewActions` not found.

- [ ] **Step 3: Implement reviewActions.ts and update public query**

Create `app/actions/reviewActions.ts`:
- Implement `submitCityGuideReviewAction`, `updateCityGuideReviewAction`, `reportCityGuideReviewAction`, `moderateReviewAction`, `deleteReviewAction`.
- All actions catch domain errors and return typed `ActionResult<T>`.
- Re-export them in `app/actions.ts`.

Update `app/travelguide/page.tsx`:
- Filter `reviews` include query:
  ```ts
  reviews: {
      where: userId
          ? {
                OR: [
                    { status: 'APPROVED' },
                    { userId },
                ],
            }
          : { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      include: {
          user: {
              select: {
                  id: true,
                  name: true,
                  image: true,
              },
          },
      },
  },
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/actions/reviewActions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/actions/reviewActions.ts app/actions.ts app/travelguide/page.tsx __tests__/actions/reviewActions.test.ts
git commit -m "feat(actions): add typed review actions and filter public travel guide query (#82)"
```

---

### Task 4: Traveler UI: Travel Guide & Profile Review Editing / Reporting

**Files:**
- Modify: `components/ui/TravelGuideClient.tsx`
- Modify: `components/ui/ProfileClient.tsx`
- Create: `components/ui/ReportReviewModal.tsx`
- Create: `__tests__/components/travelGuideReviews.test.tsx`

**Interfaces:**
- Consumes: `submitCityGuideReviewAction`, `updateCityGuideReviewAction`, `reportCityGuideReviewAction`
- Produces:
  - Accessible Report Review Modal
  - Author in-place review edit capability
  - Status badge on pending/hidden reviews for author
  - Profile review inline edit mode

- [ ] **Step 1: Write component unit tests for review editing and reporting**

Create `__tests__/components/travelGuideReviews.test.tsx`:
```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TravelGuideClient from '@/components/ui/TravelGuideClient';
import * as actions from '@/app/actions';

jest.mock('@/app/actions');
jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'viewer-id', name: 'Viewer Traveler' } },
        status: 'authenticated',
    }),
}));

describe('TravelGuideClient Reviews & Reporting', () => {
    const mockCities = [
        {
            id: 1,
            city: 'Kyoto',
            country: 'Japan',
            description: 'Historic city with temples and shrines.',
            coverImage: null,
            attractions: ['Fushimi Inari'],
            reviews: [
                {
                    id: 'rev-1',
                    rating: 5,
                    content: 'Incredible serene bamboo forests!',
                    status: 'APPROVED',
                    createdAt: new Date('2026-01-01T12:00:00Z'),
                    updatedAt: new Date('2026-01-01T12:00:00Z'),
                    userId: 'author-id',
                    user: { id: 'author-id', name: 'Author Traveler', image: null },
                },
            ],
        },
    ];

    it('renders report button for non-author and opens report modal', async () => {
        render(<TravelGuideClient cities={mockCities as any} initialFavorites={[]} />);

        // Click city card to open details
        fireEvent.click(screen.getByText('Kyoto'));

        const reportBtn = screen.getByRole('button', { name: /report review/i });
        expect(reportBtn).toBeInTheDocument();

        fireEvent.click(reportBtn);
        expect(screen.getByRole('dialog', { name: /report review/i })).toBeInTheDocument();
    });

    it('renders edited indicator when review was updated', () => {
        const editedCities = [
            {
                ...mockCities[0],
                reviews: [
                    {
                        ...mockCities[0].reviews[0],
                        updatedAt: new Date('2026-01-02T12:00:00Z'), // 1 day later
                    },
                ],
            },
        ];

        render(<TravelGuideClient cities={editedCities as any} initialFavorites={[]} />);
        fireEvent.click(screen.getByText('Kyoto'));

        expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/travelGuideReviews.test.tsx`
Expected: FAIL with missing report review button or modal.

- [ ] **Step 3: Implement ReportReviewModal and update TravelGuideClient and ProfileClient**

Create `components/ui/ReportReviewModal.tsx`:
- Accessible modal dialog (`role="dialog"`, `aria-labelledby="report-modal-title"`, `aria-modal="true"`).
- Select input for `reason` (`SPAM`, `OFFENSIVE`, `HARASSMENT`, `MISINFORMATION`, `OTHER`).
- Textarea for `details` (max 500 chars).
- Submits to `reportCityGuideReviewAction` with inline loading and notification banners (`role="alert"`).

Update `components/ui/TravelGuideClient.tsx`:
- Render report button on reviews when logged in and `userId !== r.userId`.
- Show `(edited)` tag when `new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime() > 60_000`.
- If viewer is the author of a review on the selected city:
  - Populate review form with "Update Review" button and "Cancel Edit" button.
  - Show "Under Moderator Review" badge if `r.status !== 'APPROVED'`.

Update `components/ui/ProfileClient.tsx`:
- Add "Edit" button to reviews list.
- Inline edit form with star selector and textarea calling `updateCityGuideReviewAction`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/travelGuideReviews.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ReportReviewModal.tsx components/ui/TravelGuideClient.tsx components/ui/ProfileClient.tsx __tests__/components/travelGuideReviews.test.tsx
git commit -m "feat(ui): add review reporting modal and traveler author edit controls (#82)"
```

---

### Task 5: Staff UI: Admin Review Moderation Portal & Dashboard Link

**Files:**
- Create: `app/admin/reviews/page.tsx`
- Create: `components/admin/ReviewModerationClient.tsx`
- Modify: `app/admin/page.tsx`
- Create: `__tests__/admin/reviewModeration.test.tsx`

**Interfaces:**
- Consumes: `moderateReviewAction`, `deleteReviewAction`, `prisma`
- Produces:
  - Dedicated Review Moderation Portal at `/admin/reviews`
  - Stat cards, queue filtering, report reason inspector, and audit log table
  - "Review Moderation" card on `/admin` dashboard

- [ ] **Step 1: Write component unit tests for admin review moderation portal**

Create `__tests__/admin/reviewModeration.test.tsx`:
```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewModerationClient from '@/components/admin/ReviewModerationClient';
import * as actions from '@/app/actions';

jest.mock('@/app/actions');
jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn() }),
}));

describe('ReviewModerationClient', () => {
    const mockReviews = [
        {
            id: 'rev-reported',
            content: 'Spam link to external website.',
            rating: 1,
            status: 'APPROVED',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            cityGuide: { city: 'Paris', country: 'France' },
            user: { name: 'Suspect User', email: 'suspect@example.com' },
            reports: [
                {
                    id: 'rep-1',
                    reason: 'SPAM',
                    details: 'Check this link',
                    status: 'PENDING',
                    reporter: { name: 'Alert Traveler' },
                    createdAt: new Date('2026-01-02T00:00:00Z'),
                },
            ],
        },
    ];

    const mockAudits = [
        {
            id: 'aud-1',
            action: 'HIDE',
            reason: 'Automated threshold: 3+ user reports',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            moderator: { name: 'System' },
            review: { cityGuide: { city: 'Paris' } },
        },
    ];

    it('renders queue and executes moderation hide action', async () => {
        (actions.moderateReviewAction as jest.Mock).mockResolvedValue({ ok: true });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        expect(screen.getByText(/Spam link to external website/i)).toBeInTheDocument();
        expect(screen.getByText(/1x SPAM/i)).toBeInTheDocument();

        const hideBtn = screen.getByRole('button', { name: /^hide$/i });
        fireEvent.click(hideBtn);

        await waitFor(() => {
            expect(actions.moderateReviewAction).toHaveBeenCalledWith(
                'rev-reported',
                'HIDE',
                expect.any(String)
            );
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/admin/reviewModeration.test.tsx`
Expected: FAIL with module `@/components/admin/ReviewModerationClient` not found.

- [ ] **Step 3: Implement ReviewModerationClient, admin page, and dashboard link**

Create `components/admin/ReviewModerationClient.tsx`:
- Filter tabs: *Needs Attention*, *Hidden*, *All Reviews*, *Audit Trail*.
- Summary metric cards.
- Review card with expandable report details and action buttons (`Approve`, `Hide`, `Dismiss Reports`, `Delete`).
- Audit trail table showing past moderation logs.

Create `app/admin/reviews/page.tsx`:
- Gated with `hasVerifiedStaffAccess`. Redirects unauthenticated/unauthorized users.
- Server component querying reviews, pending reports, and moderation audits from Prisma.
- Renders `ReviewModerationClient`.

Update `app/admin/page.tsx`:
- Add "Review Moderation" card linking to `/admin/reviews` with description and icon.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/admin/reviewModeration.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/reviews/page.tsx components/admin/ReviewModerationClient.tsx app/admin/page.tsx __tests__/admin/reviewModeration.test.tsx
git commit -m "feat(admin): create review moderation portal and dashboard link (#82)"
```

---

### Task 6: Full Verification, Node 22 CI Alignment & Final Polish

**Files:**
- Modify: `.github/workflows/ci.yml` (align Node version to 22 with `package.json`)
- Modify: `__tests__/ci/ciWorkflow.test.ts`

- [ ] **Step 1: Align CI workflow with Node 22 engine specification**

In `.github/workflows/ci.yml`:
- Set `node-version: 22` in `verify`, `security`, and `database` jobs to match `package.json` (`"engines": { "node": ">=22 <23" }`).

In `__tests__/ci/ciWorkflow.test.ts`:
- Update `expect(String(setupNodeStep?.with?.['node-version'])).toBe('22');`.

- [ ] **Step 2: Run full unit and database verification suites**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:database
```
Expected: 0 errors across all checks.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml __tests__/ci/ciWorkflow.test.ts
git commit -m "fix(ci): standardize CI node version to 22 matching engines requirement (#90)"
```
