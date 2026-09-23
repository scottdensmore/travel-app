# Customer Support Workflows Specification (P4.4, Issue #86)

**Status**: Draft / Pending Plan  
**Target Milestone**: Phase 4  
**Date**: 2026-09-23  

---

## 1. Overview & Context

This specification defines the complete end-to-end customer support workflows for Mona Airways, closing the final milestone item of Phase 4 (**Issue #86: P4.4 Add customer-support workflows**). Building upon the scoped staff permissions, immutable audit logging, and Step-Up TOTP verification primitives delivered in Issue #85, this slice empowers authorized support staff (`ADMIN` and `SUPPORT` roles) to efficiently manage traveler bookings, investigate customer inquiries, resolve flight disruptions, reassign seats, execute cancellations and refunds, inspect and record internal notes, and resend confirmations and receipts.

### Key Objectives
1. **Multi-Parameter Search & Pagination**:
   - Filter bookings across reference, customer name, customer email, passenger name, flight number, booking status, and flight departure date range.
   - Provide standard offset pagination (`page`, `pageSize: 25`, `totalPages`, `totalCount`) to scale to large booking volumes.
2. **Authorized Staff Mutations with Audit Trails**:
   - Staff seat reassignment, rebooking, and internal note creation backed by structured `StaffAuditLog` records.
   - Privileged booking cancellation and refund operations protected by mandatory Step-Up TOTP authentication.
3. **Internal Note Isolation**:
   - Support staff can add and review chronological internal customer support notes on any booking without exposing these notes to customer-facing views or data exports.
4. **Document & Receipt Resend**:
   - Trigger customer confirmation emails and tax invoice receipts with one-click support actions and direct PDF download links.

---

## 2. Requirements & Acceptance Criteria

### Requirements (Issue #86)
- [x] Search bookings by confirmation, customer, flight, and date.
- [x] Resend confirmations and receipts.
- [x] Perform authorized seat changes, cancellations, refunds, and rebooking.
- [x] Add internal notes without exposing them to customers.
- [x] Paginate large customer, booking, flight, and notification datasets.

### Acceptance Criteria
- **Domain Sharing**: Support actions use the same domain services and validation rules as self-service customer actions (e.g. seat map occupancy, checked-in guard, rebooking constraints).
- **Security & Authorization**: Every support operation enforces scoped permissions (`BOOKINGS_READ`, `BOOKINGS_WRITE`, `BOOKINGS_WRITE_NOTES`, `BOOKINGS_REFUND`, `NOTIFICATIONS_RESEND`).
- **Auditability**: Sensitive state transitions and customer notes record the authenticated staff actor ID, email, role, justification reason, and before/after diffs in `StaffAuditLog`.
- **Privileged Step-Up**: Cancellations and refunds require valid TOTP step-up authentication within a 15-minute cached window or via fresh 6-digit TOTP input.
- **Privacy & Hygiene**: Internal notes are never leaked to customer-facing APIs, profile views, or GDPR personal data exports.

---

## 3. Domain Architecture (`lib/customerSupportService.ts`)

The customer support domain service acts as the central orchestrator for support queries and operations:

### 3.1 Data Structures
```typescript
import { BookingStatus, Prisma } from '@prisma/client';

export interface SupportSearchQuery {
    reference?: string;
    emailOrName?: string;
    flightNumber?: string;
    status?: BookingStatus;
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
    page?: number;     // 1-indexed, default: 1
    pageSize?: number; // default: 25
}

export interface SupportBookingItem {
    id: number;
    reference: string;
    status: BookingStatus;
    totalPriceCents: number;
    currency: string;
    createdAt: Date;
    user: {
        id: string;
        name: string | null;
        email: string | null;
    } | null;
    legs: Array<{
        id: number;
        sequence: number;
        flight: {
            id: string;
            flightNumber: string;
            airline: string;
            fromAirportCode: string;
            toAirportCode: string;
            departureDate: Date;
            status: string;
        };
    }>;
    passengers: Array<{
        id: string;
        firstName: string;
        lastName: string;
        seatAssignments: Array<{
            id: string;
            flightId: string;
            seatNumber: string;
            cabinClass: string;
            releasedAt: Date | null;
        }>;
    }>;
    notesCount: number;
}

export interface SupportSearchResult {
    bookings: SupportBookingItem[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
```

### 3.2 Service Functions
1. **`searchBookings(query: SupportSearchQuery): Promise<SupportSearchResult>`**:
   - Constructs a composite `Prisma.BookingWhereInput`:
     - `reference`: Case-insensitive substring match.
     - `status`: Exact enum match if specified.
     - `emailOrName`: Matches `user.email`, `user.name`, or passenger names (`passengers.some.OR: [{ firstName }, { lastName }]`).
     - `flightNumber`: Matches `legs.some.flight.flightNumber`.
     - `dateFrom` / `dateTo`: Matches `legs.some.flight.departureDate` between start of `dateFrom` and end of `dateTo`.
   - Executes `Promise.all` for `prisma.booking.findMany` (with `skip: (page - 1) * pageSize`, `take: pageSize`, `orderBy: { createdAt: 'desc' }`) and `prisma.booking.count({ where })`.
   - Maps notes count: `_count: { select: { notes: true } }`.

2. **`getBookingNotes(bookingId: number): Promise<BookingNoteItem[]>`**:
   - Queries `prisma.bookingNote.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { id: true, name: true, email: true, role: true } } } })`.

3. **`addInternalNote(bookingId: number, actorUserId: string, text: string): Promise<BookingNote>`**:
   - Persists a new `BookingNote` associated with the booking and staff actor.

4. **`resendConfirmationEmail(bookingId: number): Promise<{ success: true; sentTo: string }>`**:
   - Fetches booking and delegates to `sendTravelDocumentsEmail`.

5. **`resendReceiptEmail(bookingId: number): Promise<{ success: true; sentTo: string }>`**:
   - Fetches booking with payments, passengers, and legs.
   - Invokes `generateInvoicePDF(booking)` from `lib/documents/pdfGenerator.ts`.
   - Dispatches receipt email with summary details and tax invoice.

6. **`staffChangeBookingSeats(bookingId: number, seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>, actorUserId: string, reason: string): Promise<void>`**:
   - Reuses seat validation rules: verifies held seats, prevents moving seats on checked-in legs or cancelled flights, and executes transactional seat reassignment.

7. **`staffRebookItinerary(bookingId: number, request: RebookItineraryRequest, actorUserId: string, reason: string): Promise<RebookResult>`**:
   - Reuses `ItineraryRebookingService` with `ownerUserId = booking.userId` and `actorUserId = staffUserId`.

8. **`cancelAndRefundBooking(bookingId: number, actorUserId: string, reason: string): Promise<Booking>`**:
   - Sets PostgreSQL session variables `app.booking_status_reason` and `app.booking_status_actor`.
   - Cancels booking, releases held seats, and sets status to `CANCELLED`.

---

## 4. Permissions & Audit Security Matrix

All operations enforce the permissions established in `lib/staffPermissions.ts` and `lib/staffAuthorization.ts`:

| Operation | Action / Server Action | Staff Permission | Privileged (MFA Step-Up)? | Audit Action |
|---|---|---|---|---|
| Search Bookings | `searchBookingsAction` | `StaffPermission.BOOKINGS_READ` | No | None (Read query) |
| View Notes | `getBookingNotesAction` | `StaffPermission.BOOKINGS_READ` | No | None (Read query) |
| Add Internal Note | `addBookingNoteAction` | `StaffPermission.BOOKINGS_WRITE_NOTES` | No | `BOOKING_ADD_NOTE` |
| Resend Confirmation | `resendEmailAction` | `StaffPermission.NOTIFICATIONS_RESEND` | No | `BOOKING_RESEND_CONFIRMATION` |
| Resend Receipt | `resendReceiptEmailAction` | `StaffPermission.NOTIFICATIONS_RESEND` | No | `BOOKING_RESEND_RECEIPT` |
| Change Seats | `staffChangeBookingSeatsAction` | `StaffPermission.BOOKINGS_WRITE` | No | `BOOKING_SEAT_CHANGE` |
| Rebook Itinerary | `staffRebookItineraryAction` | `StaffPermission.BOOKINGS_WRITE` | No | `BOOKING_REBOOK` |
| Cancel & Refund | `cancelBookingAction` | `StaffPermission.BOOKINGS_REFUND` | **Yes (15-min cache or 6-digit TOTP)** | `BOOKING_CANCEL_REFUND` |

### Step-Up Enforcement on Cancellation / Refund
```typescript
const actor = await assertPrivilegedStaffOperation({
    session,
    permission: StaffPermission.BOOKINGS_REFUND,
    stepUpCode,
});
```
If the staff user has not verified TOTP in the last 15 minutes, `assertPrivilegedStaffOperation` throws `StaffStepUpRequiredError`, signaling the client to prompt for a 6-digit authenticator code.

---

## 5. Server Actions (`app/admin/bookings/actions.ts`)

Server actions enforce authorization, validate inputs with Zod schemas, execute domain functions, write to `StaffAuditLog`, and revalidate paths:

1. **`searchBookingsAction(query: SupportSearchQueryInput)`**:
   - Requires `BOOKINGS_READ`.
   - Validates query against `supportSearchQuerySchema`.
   - Returns `SupportSearchResult`.
2. **`getBookingNotesAction(bookingId: number)`**:
   - Requires `BOOKINGS_READ`.
   - Returns notes array.
3. **`addBookingNoteAction(bookingId: number, note: string)`**:
   - Requires `BOOKINGS_WRITE_NOTES`.
   - Logs `recordStaffAudit({ action: 'BOOKING_ADD_NOTE', ... })`.
   - Revalidates `/admin/bookings`.
4. **`resendEmailAction(bookingId: number)`**:
   - Requires `NOTIFICATIONS_RESEND`.
   - Logs `recordStaffAudit({ action: 'BOOKING_RESEND_CONFIRMATION', ... })`.
5. **`resendReceiptEmailAction(bookingId: number)`**:
   - Requires `NOTIFICATIONS_RESEND`.
   - Logs `recordStaffAudit({ action: 'BOOKING_RESEND_RECEIPT', ... })`.
6. **`staffChangeBookingSeatsAction(input: StaffSeatChangeInput)`**:
   - Requires `BOOKINGS_WRITE`.
   - Logs `recordStaffAudit({ action: 'BOOKING_SEAT_CHANGE', beforeState, afterState, reason })`.
   - Revalidates `/admin/bookings`.
7. **`staffRebookItineraryAction(input: StaffRebookInput)`**:
   - Requires `BOOKINGS_WRITE`.
   - Logs `recordStaffAudit({ action: 'BOOKING_REBOOK', beforeState, afterState, reason })`.
   - Revalidates `/admin/bookings`.
8. **`cancelBookingAction(bookingId: number, reason: string, stepUpCode?: string)`**:
   - Requires `BOOKINGS_REFUND` + Step-Up.
   - Logs `recordStaffAudit({ action: 'BOOKING_CANCEL_REFUND', beforeState, afterState, reason })`.
   - Revalidates `/admin/bookings`.

---

## 6. User Interface & Accessible Modal Workflows

### 6.1 Booking Management Portal (`components/admin/BookingManagementPortal.tsx`)
Rendered by `app/admin/bookings/page.tsx` (protected by `hasStaffPermission(session, StaffPermission.BOOKINGS_READ)`):

- **Filter Bar**:
  - Reference input (placeholder: `MA-XXXXXX`)
  - Customer input (placeholder: `Customer name or email`)
  - Flight number input (placeholder: `MA101`)
  - Status select dropdown (`All Statuses`, `CONFIRMED`, `CANCELLED`, `DISRUPTED`)
  - Date inputs: `dateFrom` and `dateTo` (`type="date"`)
  - "Search" button & "Reset Filters" button
- **Results Summary & Pagination**:
  - Result count badge: `"Showing 1–25 of 48 bookings"`
  - Pagination navigation buttons: `Previous`, `Next`, current page badge, and disabled states on edge pages
- **Data Table**:
  - `Reference`: Monospaced badge with copy button
  - `Customer`: Name & email
  - `Itinerary`: List of legs with flight number, route (`JFK → LHR`), departure time, and status badge
  - `Status`: Color-coded badge (`CONFIRMED` in emerald, `CANCELLED` in rose, `DISRUPTED` in amber)
  - `Internal Notes`: Button with count badge (`(2) 📝`) opening Notes Modal
  - `Actions`: Action menu with:
    - Reassign Seats
    - Rebook Itinerary
    - Resend Confirmation Email
    - Resend Receipt Email
    - Download Tax Invoice PDF
    - Cancel & Refund Booking

### 6.2 Modal Workflows
1. **Internal Notes Modal**:
   - Accessible dialog with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="notes-title"`.
   - Focus trap on `Tab` / `Shift+Tab`, dismiss on `Escape`.
   - Chronological list of notes displaying actor name/email, timestamp, and note text.
   - Textarea to compose new note with loading spinner and inline validation.
2. **Seat Reassignment Modal**:
   - Displays passengers and current seat numbers per leg.
   - Interactive inputs/selectors to choose new seat codes.
   - Mandatory operational justification input.
   - Submits `staffChangeBookingSeatsAction`.
3. **Rebooking Modal**:
   - Displays affected flight legs.
   - Allows search and selection of alternative flights for the route.
   - Prompts for operational justification.
   - Submits `staffRebookItineraryAction`.
4. **Cancel & Refund Dialog with `StepUpModal`**:
   - Confirmation dialog prompting for cancellation reason.
   - Seamlessly transitions to `StepUpModal` if step-up verification is needed.
   - Submits `cancelBookingAction(bookingId, reason, stepUpCode)`.

---

## 7. Verification & Testing Strategy

### 7.1 Unit Tests
- `__tests__/lib/customerSupportService.test.ts`:
  - Multi-parameter search queries (reference, customer, passenger, flight, date range).
  - Pagination calculations (`page`, `pageSize`, `totalPages`, `totalCount`).
  - Receipt generation and confirmation email dispatch.
  - Internal note isolation: verifying notes are excluded from traveler-facing queries.
- `__tests__/app/adminBookings.test.ts`:
  - Scoped authorization rejection for unauthenticated users and staff lacking specific permissions.
  - Verification that mutating actions record `StaffAuditLog` with valid before/after diffs.
  - Step-Up TOTP requirement on `cancelBookingAction`.
- `__tests__/components/BookingManagementPortal.test.tsx`:
  - Search filter interactions and pagination clicks.
  - Opening and interacting with Notes Modal, Seat Reassignment Modal, and Rebooking Modal.
  - Cancel & Refund flow verifying Step-Up TOTP modal prompting.

### 7.2 Database Integration Tests (`npm run test:database`)
- `__tests__/database/customerSupport.database.test.ts`:
  - Real PostgreSQL queries verifying filtered searches across multi-leg bookings.
  - Adding and querying `BookingNote` records with foreign key cascades.
  - Transactional seat reassignment and cancellation releasing seats.
  - Verifying `StaffAuditLog` entries persist with valid JSON diffs and actor relations.

### 7.3 Verification Commands
- Typecheck: `npx tsc --noEmit`
- Linter: `npm run lint`
- Unit tests: `npm run test:unit`
- Database tests: `npm run test:database`
