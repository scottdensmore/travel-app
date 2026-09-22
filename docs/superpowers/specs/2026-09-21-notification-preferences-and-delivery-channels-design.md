# Notification Preferences & Delivery Channels Design Spec

**Date:** 2026-09-21  
**Issue:** #82 (P3.5 Make guides and notifications production-ready)  
**Status:** Approved for Implementation Planning  

---

## 1. Overview & Objectives

Issue #82 requires making the notifications system production-ready by adding:
1. **Granular Notification Preferences**: Configurable per notification category and delivery channel.
2. **Multi-Channel Delivery**: Support for In-App (notification drawer) and Email (via existing Mailpit/Postmark provider infrastructure).
3. **Graceful Degradation**: External provider timeouts, HTTP errors, or network outages must never fail or roll back the core business transactions (e.g. flight status updates, bookings, cancellations).
4. **Auditability & Staff Administration**: Durable delivery logging (`NotificationDelivery`), with an administrative portal view (`/admin/notifications`) protected by staff MFA for inspecting delivery histories and retrying failed dispatches.
5. **GDPR / Privacy Compliance**: Full integration into data export (`/api/privacy/export`) and cascading cleanup on user account deletion.

---

## 2. Architecture & Data Model

### 2.1 Enums
In `prisma/schema.prisma`:
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
```

### 2.2 Models
```prisma
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
  type        String                 // Retained for backward compatibility ("FLIGHT_STATUS" | "POINTS" | "SYSTEM")
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
  recipient      String                     // Email address or user ID
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

### 2.3 Migration Constraints
- Migration script in `prisma/migrations/20260921150000_notification_preferences_delivery/migration.sql`.
- Begins with `SET LOCAL lock_timeout = '3s';`.
- Backfills existing `Notification` records with `category`:
  - `FLIGHT_STATUS` where `type = 'FLIGHT_STATUS'`
  - `ACCOUNT_ACTIVITY` where `type = 'POINTS'` or `type = 'SYSTEM'`

---

## 3. Domain Services & Email Delivery

### 3.1 Preference Defaults (`lib/notificationService.ts`)
```ts
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
> = {
  FLIGHT_STATUS: {
    IN_APP: true,
    EMAIL: true, // Operational alerts enabled by default
  },
  ACCOUNT_ACTIVITY: {
    IN_APP: true,
    EMAIL: true, // Booking & security confirmations enabled by default
  },
  TRAVEL_GUIDES: {
    IN_APP: true,
    EMAIL: false, // Marketing/destination guides opt-in for email
  },
};
```

### 3.2 Service Methods (`NotificationService`)
1. **`getEffectivePreferences(userId: string)`**:
   - Fetches traveler's stored `NotificationPreference` rows.
   - Merges with `DEFAULT_NOTIFICATION_PREFERENCES`.
   - Returns a complete map: `Record<NotificationCategory, Record<NotificationChannel, boolean>>`.
2. **`updatePreferences(userId: string, updates: Array<{ category: NotificationCategory, channel: NotificationChannel, enabled: boolean }>)`**:
   - Validates each preference using Zod.
   - Performs upserts in a Prisma transaction (`prisma.$transaction`).
3. **`dispatchNotification(input: { userId: string; title: string; message: string; category: NotificationCategory; type?: string })`**:
   - Resolves effective preferences for `input.category`.
   - If `IN_APP` enabled: creates `Notification` record and `NotificationDelivery` (`channel: IN_APP`, `status: SENT`).
   - If `EMAIL` enabled and user has an email address:
     - Creates `NotificationDelivery` (`channel: EMAIL`, `status: PENDING`).
     - Calls `sendNotificationEmail(...)` inside a `try/catch` block.
     - On success: marks delivery `status: SENT`, `sentAt: now()`, `attempts: 1`.
     - On error: logs warning via `logger.warn` and marks delivery `status: FAILED`, `error: err.message`, `attempts: 1`, `lastAttemptAt: now()`.
     - Ensures calling business operations (e.g. flight status update, cancellations, bookings) never fail due to email errors.
4. **`retryDelivery(deliveryId: string)`**:
   - Staff-authorized action to retry a failed email delivery.
   - Re-runs `sendNotificationEmail`, increments `attempts`, and updates `lastAttemptAt` and `status`.

### 3.3 Email Adapter (`lib/notificationEmail.ts`)
- Reuses existing environment configuration:
  - `AUTH_EMAIL_PROVIDER` (`mailpit` in local/CI, `postmark` in production).
  - `AUTH_EMAIL_API_URL` (Mailpit endpoint or Postmark `/email`).
  - `AUTH_EMAIL_FROM` (e.g. `Mona Airways <no-reply@localhost>`).
- Renders plain text and HTML emails:
  - Subject: `Mona Airways: {title}`
  - Body: `{message}`
  - Footer: `Manage your notification preferences at {NEXTAUTH_URL}/profile/notifications`.

---

## 4. Server Actions & Event Integration

### 4.1 Server Actions (`app/actions/notificationActions.ts`)
- `getNotificationPreferencesAction()`:
  - Authenticated session required.
  - Returns `ActionResult<EffectivePreferences>`.
- `updateNotificationPreferencesAction(input: unknown)`:
  - Authenticated session required.
  - Validates `updates` array with Zod schema.
  - Returns `ActionResult<{ success: true }>`.
  - Revalidates `/profile/notifications`.
- `getAdminNotificationDeliveriesAction(filters: unknown)`:
  - Requires `hasVerifiedStaffAccess`.
  - Validates filters: `status`, `channel`, `page`, `pageSize`, `search`.
  - Returns `ActionResult<DeliveryAuditList>`.
- `retryNotificationDeliveryAction(deliveryId: unknown)`:
  - Requires `hasVerifiedStaffAccess`.
  - Re-attempts dispatch via `NotificationService.retryDelivery`.
  - Returns `ActionResult<{ success: true, delivery: DeliverySummary }>`.
  - Revalidates `/admin/notifications`.

### 4.2 Business Event Integration
1. **Flight Status Updates (`updateFlightStatusAction` in `app/actions.ts`)**:
   - Replaces raw in-app insert with `notificationService.dispatchNotification` using `category: 'FLIGHT_STATUS'`.
2. **Booking Confirmation & Points Earned (checkout flow in `app/actions.ts`)**:
   - Dispatches confirmation and points notice with `category: 'ACCOUNT_ACTIVITY'`.
3. **Booking Cancellation & Points Deduction (cancellation flow in `app/actions.ts`)**:
   - Dispatches cancellation notice with `category: 'ACCOUNT_ACTIVITY'`.

---

## 5. User Interface

### 5.1 Traveler Notification Preferences (`/profile/notifications`)
- Route: `app/profile/notifications/page.tsx` (Server component, auth protected).
- Client component: `components/profile/NotificationPreferencesClient.tsx`.
- Preference matrix table:
  - Rows:
    - **Flight Status & Operational Alerts**
    - **Account & Bookings**
    - **Travel Guides & Tips**
  - Columns:
    - **In-App Notifications**
    - **Email Delivery**
  - Accessible toggle switches with `role="switch"`, `aria-checked`, and accessible labels.
  - Inline saving indicator, success message (`role="status"`), and error banner.
- Navigation links:
  - Added to sidebar menu in `components/ui/ProfileClient.tsx`.
  - Added to header in `components/ui/titlebar.tsx` notification drawer (`aria-label="Notification settings"`).

### 5.2 Staff Notification Audit Portal (`/admin/notifications`)
- Route: `app/admin/notifications/page.tsx` (Server component, protected by `hasVerifiedStaffAccess`).
- Client component: `components/admin/AdminNotificationDeliveriesClient.tsx`.
- Summary metrics: Total dispatches, Sent count, Failed count.
- Filter tabs: All, Failed, Sent, Pending; Channel selector (All, Email, In-App).
- Audit table:
  - Timestamp, Category, Channel, Recipient, Title/Message snippet, Status badge, Attempts, Actions.
  - Error inspector showing exact failure message for failed dispatches.
  - One-click "Retry Delivery" button on failed rows.
- Navigation card in `app/admin/page.tsx`.

---

## 6. Privacy & GDPR Compliance

In `lib/privacyService.ts`:
1. **Data Export (`/api/privacy/export`)**:
   - Exports traveler's `notificationPreferences`.
   - Exports delivery logs associated with traveler's notifications.
2. **Account Deletion**:
   - Cascading foreign keys (`onDelete: Cascade`) remove all preferences and notifications upon user deletion.

---

## 7. Verification & Test Plan

1. **Unit Tests**:
   - `__tests__/lib/notificationService.test.ts`:
     - Default preference resolution.
     - Updating preferences with validation.
     - Multi-channel dispatching obeying preferences.
     - Provider failure isolation (in-app succeeds, email marked `FAILED`, no uncaught exceptions).
     - Staff retry execution and status update.
   - `__tests__/actions/notificationActions.test.ts`:
     - Auth session checks.
     - Staff verification gate (`hasVerifiedStaffAccess`).
     - Validation failure contracts.
   - `__tests__/components/NotificationPreferencesClient.test.tsx`:
     - Matrix rendering, toggle interactions, saving and error feedback.
   - `__tests__/admin/AdminNotificationDeliveriesClient.test.tsx`:
     - Audit table rendering, status filtering, and retry interaction.
2. **Database Tests**:
   - `__tests__/database/notificationPreferences.database.test.ts`:
     - Unique constraint `@@unique([userId, category, channel])`.
     - Foreign key cascades on user and notification deletion.
   - `__tests__/lib/privacyService.database.test.ts`:
     - Verifies preferences and deliveries appear in privacy data export.
3. **Full Suite**:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run test:unit`
   - `npm run test:database`
