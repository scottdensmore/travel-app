# Admin Customer Support Booking Search and Management Portal Design

## 1. Overview
The Admin Customer Support Portal allows verified staff to search for bookings, view detailed booking information, and perform customer support actions such as resending emails, cancelling bookings with refunds, and adding internal notes.

## 2. Requirements

### 2.1 Dedicated Portal Route
- Route: `/admin/bookings`
- Files: `app/admin/bookings/page.tsx`, `components/admin/BookingManagementPortal.tsx`.
- Authorization: Protected by `ADMIN` role and verified staff session (relying on `app/admin/layout.tsx` but explicitly checking in `page.tsx`).
- Navigation: Add navigation link to `/admin/bookings` in admin header/navigation (e.g., in `app/admin/page.tsx` or wherever the layout header is).

### 2.2 Search & Filters
- Fast search filter by:
  - Booking Reference (`MA-XXXXX`)
  - Customer Email or Name
  - Flight Number & Date Range
  - Status (`CONFIRMED`, `CANCELLED`, `DISRUPTED`)
- Server-side filtering or client-side filtering depending on volume. Since it's an admin portal, server-side search is preferred. We can build an API route or server actions for search.

### 2.3 Booking Detail View / Drawer
- Passenger manifest with seat assignments and cabin class.
- Itinerary legs with scheduled departure/arrival times, terminals, gates.
- Stripe payment attempt ID, amount, and reconciliation status.
- Complete timeline / audit log of `BookingStatusChange` events.

### 2.4 Customer Support Actions
- Resend Confirmation Email: Triggers re-delivery of confirmation & e-ticket via `sendTravelDocumentEmail`.
- Staff Cancellation & Refund: Initiates authorized cancellation and refund with staff reason tracking (`actorUserId`).
- Internal Staff Notes: Append-only internal notes on a booking for customer support handoffs.

## 3. Data Model Additions
- We will add an `InternalNote` or `BookingNote` model to `schema.prisma`:
  - `id` (String)
  - `bookingId` (Int)
  - `actorUserId` (String)
  - `text` (String)
  - `createdAt` (DateTime)
- We will update the `Booking` model to include a relation to `notes`.

## 4. Testing & Verification
- Unit and database integration tests in `__tests__/lib/customerSupportService.database.test.ts` and `__tests__/app/adminBookings.test.ts`.
- Component tests in `__tests__/components/BookingManagementPortal.test.tsx`.
- Authorization tests verifying non-admins cannot access endpoints or execute actions.
- Follow strict TDD: Red -> Green -> Refactor.
