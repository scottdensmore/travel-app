# Admin Support Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a customer support booking search and management portal for administrators.

**Architecture:** We will add a `BookingNote` model to Prisma to store append-only internal notes. We will build `lib/customerSupportService.ts` for the business logic (search, cancel, notes, resend email). The UI will live in `components/admin/BookingManagementPortal.tsx` and be exposed at `/admin/bookings`.

**Tech Stack:** Next.js (App Router), Prisma, React, Tailwind CSS, Jest (for testing).

**Spec:** `docs/superpowers/specs/2026-09-19-admin-support-portal-design.md`

## Global Constraints

- Must follow strict TDD. Write failing tests first.
- Only verified staff with ADMIN role can access the portal and its actions.

---

### Task 1: Update Database Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `BookingNote` model**
```prisma
model BookingNote {
  id          String   @id @default(cuid())
  bookingId   Int
  booking     Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  actorUserId String
  actor       User     @relation(fields: [actorUserId], references: [id])
  text        String
  createdAt   DateTime @default(now())

  @@index([bookingId, createdAt])
}
```
Add `notes BookingNote[]` to the `Booking` model.
Add `notesWritten BookingNote[]` to the `User` model.

- [ ] **Step 2: Generate Prisma Client**
Run: `npx prisma generate`
Expected: Successfully generated Prisma Client.

- [ ] **Step 3: Commit**
```bash
git add prisma/schema.prisma
git commit -m "feat(admin): add BookingNote model for support portal"
```

### Task 2: Create Customer Support Service and Tests

**Files:**
- Create: `lib/customerSupportService.ts`
- Create: `__tests__/lib/customerSupportService.database.test.ts`

- [ ] **Step 1: Write failing database tests**
Create `__tests__/lib/customerSupportService.database.test.ts` with tests for:
- `searchBookings(query)`: By reference, email, flight number, status.
- `addInternalNote(bookingId, actorUserId, text)`: Creates a note.
- `cancelAndRefundBooking(bookingId, actorUserId, reason)`: Changes status, logs actor.
- `resendConfirmationEmail(bookingId)`: Fetches data and calls `sendTravelDocumentsEmail`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test:database -- __tests__/lib/customerSupportService.database.test.ts`
Expected: FAIL due to missing file.

- [ ] **Step 3: Write minimal implementation**
Implement `lib/customerSupportService.ts` to satisfy the tests using Prisma. Ensure we import `sendTravelDocumentsEmail` correctly and `prisma`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test:database -- __tests__/lib/customerSupportService.database.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add lib/customerSupportService.ts __tests__/lib/customerSupportService.database.test.ts
git commit -m "feat(admin): implement customer support service"
```

### Task 3: Booking Management Component

**Files:**
- Create: `components/admin/BookingManagementPortal.tsx`
- Create: `__tests__/components/BookingManagementPortal.test.tsx`

- [ ] **Step 1: Write failing component test**
Create `__tests__/components/BookingManagementPortal.test.tsx`. Test rendering, search input, and displaying mock booking results.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test:unit -- __tests__/components/BookingManagementPortal.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
Implement the component with a search bar, results table, and a detail view/drawer that lists passenger manifest, itinerary legs, payment status, timeline, and actions (resend email, cancel, add note). Use Server Actions or API routes for data fetching (we will pass these as props or rely on Next.js Server Actions).

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test:unit -- __tests__/components/BookingManagementPortal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add components/admin/BookingManagementPortal.tsx __tests__/components/BookingManagementPortal.test.tsx
git commit -m "feat(admin): booking management portal UI"
```

### Task 4: Portal Route and Actions

**Files:**
- Create: `app/admin/bookings/page.tsx`
- Create: `app/admin/bookings/actions.ts`
- Create: `__tests__/app/adminBookings.test.ts`
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Write failing test**
Create `__tests__/app/adminBookings.test.ts` testing the server actions ensure `hasVerifiedStaffAccess` and `session.user.role === 'ADMIN'` is checked.

- [ ] **Step 2: Write minimal implementation**
Implement `app/admin/bookings/actions.ts` exporting functions like `searchBookingsAction`, `addNoteAction`, etc., all guarded by auth checks.
Implement `app/admin/bookings/page.tsx` ensuring auth checks and rendering `<BookingManagementPortal />`.
Update `app/admin/page.tsx` to add a link to `/admin/bookings`.

- [ ] **Step 3: Run tests to verify they pass**
Run tests for authorization and UI. Ensure types compile.

- [ ] **Step 4: Commit**
```bash
git add app/admin/bookings __tests__/app/adminBookings.test.ts app/admin/page.tsx
git commit -m "feat(admin): support portal route and server actions"
```
