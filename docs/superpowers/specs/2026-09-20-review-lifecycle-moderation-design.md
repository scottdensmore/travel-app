# Review Lifecycle, Reporting, and Moderation Design Spec

**Issue Reference:** [#82 (P3.5 Make guides and notifications production-ready)](https://github.com/scottdensmore/travel-app/issues/82) — Sub-Project 2: Review Lifecycle & Moderation  
**Date:** September 20, 2026  
**Status:** Approved for Implementation Planning  

---

## 1. Overview & Objectives

In the Mona Airways travel platform, travelers can view city guides and read or submit reviews. Previously, reviews were created without editing capabilities, without user reporting mechanisms, without an admin moderation queue, and without an audit trail of moderation decisions. Furthermore, any user could post multiple reviews for the same city guide without limit.

This specification details **Sub-Project 2 of Issue #82**:
1. **Validation & Authoring Controls**: Enforce rating bounds (1–5), character length constraints (10–2,000 characters), input sanitization, and a one-review-per-user-per-city-guide constraint.
2. **Review Editing**: Allow authors to edit their published reviews with updated rating, content, and an `(edited)` indicator. If a review was previously hidden by staff, editing places it back into pending moderation for staff re-review.
3. **User Reporting**: Enable authenticated travelers to report reviews for specific violations (`SPAM`, `OFFENSIVE`, `HARASSMENT`, `MISINFORMATION`, `OTHER`) with optional details. Prevent self-reporting and duplicate reporting by the same user.
4. **Automated Threshold Concealment**: Automatically transition a review's status to `HIDDEN` pending staff review once it accumulates $\ge 3$ active pending reports.
5. **Admin Moderation Portal**: Provide a dedicated staff portal at `/admin/reviews` allowing authorized staff (`hasVerifiedStaffAccess`) to view pending/reported reviews, inspect report reasons, approve, hide, dismiss false-positive reports, or delete reviews.
6. **Auditable Moderation Trail**: Record every staff moderation action and automated threshold event in a dedicated `ReviewModerationAudit` database table and in structured application logs via `lib/logger.ts`.

---

## 2. Architecture & Data Model

### 2.1 Prisma Schema Additions (`prisma/schema.prisma`)

```prisma
enum ReviewStatus {
  APPROVED
  PENDING_MODERATION
  HIDDEN
}

enum ReviewReportReason {
  SPAM
  OFFENSIVE
  HARASSMENT
  MISINFORMATION
  OTHER
}

enum ReportStatus {
  PENDING
  RESOLVED
  DISMISSED
}

enum ModerationAction {
  APPROVE
  HIDE
  DISMISS_REPORTS
  DELETE
}

model Review {
  id          String       @id @default(cuid())
  content     String
  rating      Int
  userId      String
  cityGuideId Int
  status      ReviewStatus @default(APPROVED)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @default(now()) @updatedAt

  user             User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  cityGuide        CityGuide              @relation(fields: [cityGuideId], references: [id], onDelete: Cascade)
  reports          ReviewReport[]
  moderationAudits ReviewModerationAudit[]

  @@unique([userId, cityGuideId])
  @@index([cityGuideId, status])
  @@index([status])
}

model ReviewReport {
  id         String             @id @default(cuid())
  reviewId   String
  reporterId String
  reason     ReviewReportReason
  details    String?
  status     ReportStatus       @default(PENDING)
  createdAt  DateTime           @default(now())
  resolvedAt DateTime?

  review   Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  reporter User   @relation("UserReviewReports", fields: [reporterId], references: [id], onDelete: Cascade)

  @@unique([reviewId, reporterId])
  @@index([reviewId, status])
  @@index([status])
}

model ReviewModerationAudit {
  id          String           @id @default(cuid())
  reviewId    String?
  moderatorId String
  action      ModerationAction
  reason      String?
  metadata    Json?
  createdAt   DateTime         @default(now())

  review    Review? @relation(fields: [reviewId], references: [id], onDelete: SetNull)
  moderator User    @relation("ModeratorAudits", fields: [moderatorId], references: [id], onDelete: Cascade)

  @@index([reviewId])
  @@index([moderatorId])
  @@index([createdAt])
}
```

### 2.2 User Model Relations

```prisma
model User {
  // ... existing fields ...
  reviews         Review[]
  reviewReports   ReviewReport[]          @relation("UserReviewReports")
  moderationAudits ReviewModerationAudit[] @relation("ModeratorAudits")
}
```

### 2.3 Migration & Backward Compatibility
- Migration SQL must start with `SET LOCAL lock_timeout = '3s';`.
- A pre-indexing SQL step removes or consolidates any legacy duplicate `(userId, cityGuideId)` entries (retaining the most recently created entry) so the unique index `@@unique([userId, cityGuideId])` applies cleanly without failing on existing test/seed databases.

---

## 3. Validation & Business Logic

### 3.1 Schemas (`lib/validation.ts`)
1. **`reviewSchema`**:
   - `cityGuideId`: `positiveId('City guide ID')`
   - `rating`: `z.number().int().min(1, 'Rating must be at least 1.').max(5, 'Rating cannot exceed 5.')`
   - `content`: `requiredText('Review', 2000).min(10, 'Review must be at least 10 characters long.')`
2. **`updateReviewSchema`**:
   - `reviewId`: `stringIdSchema`
   - `rating`: `z.number().int().min(1).max(5)`
   - `content`: `requiredText('Review', 2000).min(10, 'Review must be at least 10 characters long.')`
3. **`reportReviewSchema`**:
   - `reviewId`: `stringIdSchema`
   - `reason`: `z.nativeEnum(ReviewReportReason)`
   - `details`: `z.string().trim().max(500, 'Details must be 500 characters or fewer.').optional()`
4. **`moderateReviewSchema`**:
   - `reviewId`: `stringIdSchema`
   - `action`: `z.nativeEnum(ModerationAction)`
   - `reason`: `z.string().trim().max(500, 'Reason must be 500 characters or fewer.').optional()`

### 3.2 Review Moderation Domain Service (`lib/reviewModerationService.ts`)
- **Constants**:
  - `REPORT_AUTO_HIDE_THRESHOLD = 3`
- **Functions**:
  - `submitReview(userId: string, data: { cityGuideId: number; rating: number; content: string })`:
    - Checks for existing review by `(userId, cityGuideId)`. If found, throws `DuplicateReviewError` ("You have already reviewed this city guide. You can update your existing review.").
    - Creates review with `status: ReviewStatus.APPROVED`.
  - `updateReview(userId: string, isStaff: boolean, data: { reviewId: string; rating: number; content: string })`:
    - Finds existing review. If not found, throws `ReviewNotFoundError`.
    - Enforces ownership: if not staff and `review.userId !== userId`, throws `UnauthorizedError`.
    - If current review `status === 'HIDDEN'`, transitions `status = 'PENDING_MODERATION'`. If `status === 'APPROVED'`, keeps `APPROVED`.
    - Updates `rating`, `content`, and sets `updatedAt = new Date()`.
  - `reportReview(reporterId: string, data: { reviewId: string; reason: ReviewReportReason; details?: string })`:
    - Finds existing review. If not found, throws `ReviewNotFoundError`.
    - Enforces no self-reporting: if `review.userId === reporterId`, throws `CannotReportOwnReviewError` ("You cannot report your own review.").
    - Checks if `reporterId` already reported `reviewId`. If so, throws `DuplicateReportError` ("You have already reported this review.").
    - In a Prisma transaction:
      - Creates `ReviewReport` with `status: ReportStatus.PENDING`.
      - Counts total `PENDING` reports for `reviewId`.
      - If pending count $\ge 3$ and review `status === 'APPROVED'`:
        - Updates review `status = 'HIDDEN'`.
        - Creates `ReviewModerationAudit` with `action: ModerationAction.HIDE`, `reason: 'Automated threshold: 3+ user reports'`.
  - `moderateReview(moderatorId: string, data: { reviewId: string; action: ModerationAction; reason?: string })`:
    - Finds existing review. If not found, throws `ReviewNotFoundError`.
    - In a Prisma transaction:
      - If `action === 'APPROVE'`: updates review `status = 'APPROVED'`, updates linked pending reports to `RESOLVED`, sets `resolvedAt = new Date()`.
      - If `action === 'HIDE'`: updates review `status = 'HIDDEN'`, updates linked pending reports to `RESOLVED`, sets `resolvedAt = new Date()`.
      - If `action === 'DISMISS_REPORTS'`: leaves review status unchanged, updates linked pending reports to `DISMISSED`, sets `resolvedAt = new Date()`.
      - If `action === 'DELETE'`:
        - Archives review snapshot `{ content: review.content, rating: review.rating, cityGuideId: review.cityGuideId, authorId: review.userId }` in audit `metadata`.
        - Deletes review from database.
      - Creates `ReviewModerationAudit` record (`reviewId: action === 'DELETE' ? null : review.id`, `moderatorId`, `action`, `reason`, `metadata`).
  - Emits structured log events via `lib/logger.ts` for each operation.

---

## 4. Server Actions & Public Query Boundaries

### 4.1 Server Actions (`app/actions/reviewActions.ts`)
- `submitCityGuideReviewAction(cityGuideId: number, rating: number, content: string): Promise<ActionResult<Review>>`
- `updateCityGuideReviewAction(reviewId: string, rating: number, content: string): Promise<ActionResult<Review>>`
- `reportCityGuideReviewAction(reviewId: string, reason: ReviewReportReason, details?: string): Promise<ActionResult<{ reportId: string }>>`
- `moderateReviewAction(reviewId: string, action: ModerationAction, reason?: string): Promise<ActionResult<{ success: true }>>`
- `deleteReviewAction(reviewId: string): Promise<ActionResult<{ id: string }>>`
  - Re-exported through `app/actions.ts` to maintain full backward compatibility with existing callers.

### 4.2 Public Query Boundary (`app/travelguide/page.tsx`)
- Queries city guides with only `status: 'APPROVED'` reviews for public travelers:
  ```ts
  reviews: {
    where: { status: 'APPROVED' },
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
  }
  ```
- If a logged-in user is viewing the page and has an unapproved review (`PENDING_MODERATION` or `HIDDEN`), their review is also fetched so they can view its status and edit it.

---

## 5. User Interface Specifications

### 5.1 Travel Guide Component (`components/ui/TravelGuideClient.tsx`)
1. **Review Item Display**:
   - Shows user avatar, name, star rating, text, and formatted relative/absolute date.
   - If `updatedAt` is significantly greater than `createdAt` (> 60 seconds), renders an `(edited)` indicator with `title="Edited on <date>"`.
   - **Report Button**: Renders a flag/report button for logged-in non-authors.
     - Accessible modal dialog (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="report-dialog-title"`).
     - Select dropdown for violation reason.
     - Optional details textarea.
     - Cancel and Submit buttons with accessible loading states.
     - Displays inline notification upon submission.
   - **Author Controls**:
     - If viewing own review, shows an "Edit" button that toggles edit mode in place or scrolls down to populated form.
     - If author review is `PENDING_MODERATION` or `HIDDEN`, renders a status badge ("Under Moderator Review").

### 5.2 Profile Component (`components/ui/ProfileClient.tsx`)
- In "Your Reviews" list:
  - Adds an **Edit** button next to the **Delete** button.
  - Clicking "Edit" reveals an inline edit form containing star select, text area, Save, and Cancel.
  - Submits to `updateCityGuideReviewAction` with accessible feedback banners (`role="alert"`).

### 5.3 Admin Review Moderation Portal (`app/admin/reviews/page.tsx`)
- Accessible only to staff with verified 2FA / session (`hasVerifiedStaffAccess`).
- **Layout**:
  - Back link: "← Back to Dashboard".
  - Header: "Review Moderation Queue".
  - Stat summary widgets:
    - *Pending Reports*: Count of unresolved reports.
    - *Queued for Moderation*: Count of reviews in `PENDING_MODERATION`.
    - *Hidden Reviews*: Count of concealed reviews.
    - *Total Moderated*: Count of historical moderation actions.
  - **Tabs**:
    - **Needs Attention** (default): Reviews with $\ge 1$ pending report or status `PENDING_MODERATION`.
    - **Hidden**: Reviews currently set to `HIDDEN`.
    - **All Reviews**: Complete directory with city search filter.
    - **Audit Trail**: Tabular history of moderation records (`Date`, `Moderator`, `Action`, `Review ID / City`, `Reason / Note`).
  - **Moderation Actions on Review Cards**:
    - **Approve**: Green button with confirmation.
    - **Hide**: Amber button with optional reason input.
    - **Dismiss Reports**: Blue button with confirmation.
    - **Delete**: Red button with confirmation dialog.
- **Admin Dashboard Integration**: Adds "Review Moderation" navigation card to `app/admin/page.tsx`.

---

## 6. Observability, Logging, and Audit Trail

- **Structured Logger (`lib/logger.ts`)**:
  - `review.created`: `{ reviewId, cityGuideId, userId, rating }`
  - `review.updated`: `{ reviewId, cityGuideId, userId, rating, previousStatus, newStatus }`
  - `review.reported`: `{ reviewId, reporterId, reason, pendingReportsCount, autoHidden }`
  - `review.moderated`: `{ reviewId, moderatorId, action, reason }`
- **Audit Table (`ReviewModerationAudit`)**:
  - Retains immutable historical log of moderator actions.
  - When a review is permanently deleted, its text, rating, and author ID are preserved in the `metadata` JSON field so accountability is maintained.

---

## 7. Verification & Testing Strategy

1. **Unit Tests**:
   - `__tests__/lib/reviewModerationService.test.ts`:
     - Test input validation: reject ratings outside 1–5, reject text < 10 or > 2000 chars.
     - Test 1-review-per-user-per-city constraint.
     - Test author edit permissions and status transitions.
     - Test reporting: reject self-reporting, reject duplicate reporting.
     - Test automated 3-report threshold: triggers status transition to `HIDDEN` and creates audit record.
     - Test moderation actions: `APPROVE`, `HIDE`, `DISMISS_REPORTS`, `DELETE`.
   - `__tests__/actions/reviewActions.test.ts`:
     - Test session authorization and staff role validation for all actions.
   - `__tests__/components/travelGuideReviews.test.tsx`:
     - Test review rendering, `(edited)` indicator, report modal interaction, and author edit mode.
   - `__tests__/admin/reviewModeration.test.tsx`:
     - Test admin queue rendering, tab switching, reason badges, and moderation action submissions.
2. **Database Integration Tests**:
   - `__tests__/database/reviewModeration.test.ts`:
     - Test database unique constraints, cascade deletion on user/city delete, and `SetNull` on review deletion with audit trail preservation.
3. **CI Pipeline Verification**:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run test:unit`
   - `npm run test:database`
