# Customer Support Workflows Implementation Plan (P4.4, Issue #86)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement comprehensive customer support workflows in `/admin/bookings`, enabling authorized staff to perform multi-parameter searches with pagination, inspect and add internal notes, resend confirmations and receipts, reassign seats, rebook itineraries, and execute cancellations/refunds with Step-Up TOTP verification and immutable audit logging.

**Architecture:** Extend `lib/customerSupportService.ts` with pagination and support operations that share existing self-service domain engines (`changeBookingSeatsAction` rules, `ItineraryRebookingService`, and `generateInvoicePDF`). Expose typed server actions in `app/admin/bookings/actions.ts` enforcing scoped permissions and writing structured before/after diffs to `StaffAuditLog`. Upgrade `components/admin/BookingManagementPortal.tsx` with filter controls, pagination bar, and accessible modal dialogs integrated with `StepUpModal`.

**Tech Stack:** Next.js 14 (App Router, Server Actions), React 18, TypeScript, Prisma ORM, PostgreSQL, `@testing-library/react`, Jest.

**Spec:** `docs/superpowers/specs/2026-09-23-customer-support-workflows-design.md`

## Global Constraints
- Node.js engine compatibility: `>=22 <23`.
- Strict typing: zero `any` declarations in new code; all server action inputs validated via Zod.
- Security: All mutating support actions record `StaffAuditLog` entries with actor ID, email, role, target, justification reason, and before/after diffs.
- Privileged operations: `cancelBookingAction` requires `StaffPermission.BOOKINGS_REFUND` and enforces Step-Up TOTP verification (15-minute verification cache or 6-digit TOTP code).
- Customer Privacy: `BookingNote` internal notes must never be exposed in traveler-facing queries, profile views, or GDPR personal data exports.
- Database hygiene: All schema queries must be performant and index-aware; PostgreSQL migrations must include `SET LOCAL lock_timeout = '3s'`.

---

### Task 1: Search & Dataset Pagination Domain Service

**Files:**
- Modify: `lib/customerSupportService.ts`
- Test: `__tests__/lib/customerSupportService.test.ts`
- Test: `__tests__/database/customerSupportService.database.test.ts`

**Interfaces:**
- Produces:
  - `SupportSearchQuery`: interface defining multi-field search and pagination parameters (`reference`, `emailOrName`, `flightNumber`, `status`, `dateFrom`, `dateTo`, `page`, `pageSize`).
  - `SupportBookingItem`: interface for support booking records including legs, passengers, seat assignments, and `notesCount`.
  - `SupportSearchResult`: `{ bookings: SupportBookingItem[], totalCount: number, page: number, pageSize: number, totalPages: number }`.
  - `searchBookings(query: SupportSearchQuery): Promise<SupportSearchResult>` in `lib/customerSupportService.ts`.

- [ ] **Step 1: Write failing unit test for searchBookings multi-parameter filtering and pagination**

Create `__tests__/lib/customerSupportService.test.ts`:
```typescript
import { searchBookings } from '@/lib/customerSupportService';
import { prisma } from '@/lib/prisma';
import { BookingStatus } from '@prisma/client';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: {
            findMany: jest.fn(),
            count: jest.fn(),
        },
    },
}));

describe('customerSupportService.searchBookings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('searches bookings with multi-parameter filters and calculates pagination metadata', async () => {
        const mockBookings = [
            {
                id: 101,
                reference: 'MA-ABC123',
                status: BookingStatus.CONFIRMED,
                totalPriceCents: 45000,
                currency: 'USD',
                createdAt: new Date('2026-09-01T12:00:00Z'),
                user: { id: 'u1', name: 'John Doe', email: 'john@example.com' },
                legs: [
                    {
                        id: 1,
                        sequence: 1,
                        flight: {
                            id: 'f1',
                            flightNumber: 'MA101',
                            airline: 'Mona Airways',
                            fromAirportCode: 'JFK',
                            toAirportCode: 'LHR',
                            departureDate: new Date('2026-10-15T08:00:00Z'),
                            status: 'SCHEDULED',
                        },
                    },
                ],
                passengers: [
                    {
                        id: 'p1',
                        firstName: 'John',
                        lastName: 'Doe',
                        seatAssignments: [
                            { id: 'sa1', flightId: 'f1', seatNumber: '12A', cabinClass: 'ECONOMY', releasedAt: null },
                        ],
                    },
                ],
                _count: { notes: 3 },
            },
        ];

        (prisma.booking.findMany as jest.Mock).mockResolvedValue(mockBookings);
        (prisma.booking.count as jest.Mock).mockResolvedValue(42);

        const result = await searchBookings({
            reference: 'ABC',
            emailOrName: 'John',
            flightNumber: 'MA101',
            status: BookingStatus.CONFIRMED,
            dateFrom: '2026-10-01',
            dateTo: '2026-10-31',
            page: 2,
            pageSize: 10,
        });

        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(10);
        expect(result.totalCount).toBe(42);
        expect(result.totalPages).toBe(5);
        expect(result.bookings).toHaveLength(1);
        expect(result.bookings[0].notesCount).toBe(3);

        expect(prisma.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
            skip: 10,
            take: 10,
            orderBy: { createdAt: 'desc' },
            where: expect.objectContaining({
                reference: { contains: 'ABC', mode: 'insensitive' },
                status: BookingStatus.CONFIRMED,
                legs: expect.objectContaining({
                    some: expect.objectContaining({
                        flight: expect.objectContaining({
                            flightNumber: { contains: 'MA101', mode: 'insensitive' },
                            departureDate: {
                                gte: new Date('2026-10-01T00:00:00.000Z'),
                                lte: new Date('2026-10-31T23:59:59.999Z'),
                            },
                        }),
                    }),
                }),
            }),
        }));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/customerSupportService.test.ts`
Expected: FAIL (types mismatch or missing pagination properties).

- [ ] **Step 3: Implement enhanced searchBookings in lib/customerSupportService.ts**

Update `lib/customerSupportService.ts`:
```typescript
import { prisma } from '@/lib/prisma';
import { BookingStatus, Prisma } from '@prisma/client';

export interface SupportSearchQuery {
    reference?: string;
    emailOrName?: string;
    flightNumber?: string;
    status?: BookingStatus;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
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

export async function searchBookings(query: SupportSearchQuery): Promise<SupportSearchResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.BookingWhereInput = {};

    if (query.reference?.trim()) {
        where.reference = { contains: query.reference.trim(), mode: 'insensitive' };
    }
    if (query.status) {
        where.status = query.status;
    }
    if (query.emailOrName?.trim()) {
        const term = query.emailOrName.trim();
        where.OR = [
            { user: { email: { contains: term, mode: 'insensitive' } } },
            { user: { name: { contains: term, mode: 'insensitive' } } },
            { passengers: { some: { firstName: { contains: term, mode: 'insensitive' } } } },
            { passengers: { some: { lastName: { contains: term, mode: 'insensitive' } } } },
        ];
    }

    const flightConditions: Prisma.FlightWhereInput = {};
    if (query.flightNumber?.trim()) {
        flightConditions.flightNumber = { contains: query.flightNumber.trim(), mode: 'insensitive' };
    }
    if (query.dateFrom || query.dateTo) {
        const departureDateFilter: Prisma.DateTimeFilter = {};
        if (query.dateFrom) {
            departureDateFilter.gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
        }
        if (query.dateTo) {
            departureDateFilter.lte = new Date(`${query.dateTo}T23:59:59.999Z`);
        }
        flightConditions.departureDate = departureDateFilter;
    }

    if (Object.keys(flightConditions).length > 0) {
        where.legs = {
            some: {
                flight: flightConditions,
            },
        };
    }

    const [rawBookings, totalCount] = await Promise.all([
        prisma.booking.findMany({
            where,
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
                legs: {
                    include: { flight: true },
                    orderBy: { sequence: 'asc' },
                },
                passengers: {
                    include: { seatAssignments: true },
                },
                _count: {
                    select: { notes: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
        }),
        prisma.booking.count({ where }),
    ]);

    const bookings: SupportBookingItem[] = rawBookings.map((b) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        totalPriceCents: b.totalPriceCents,
        currency: b.currency,
        createdAt: b.createdAt,
        user: b.user,
        legs: b.legs.map((leg) => ({
            id: leg.id,
            sequence: leg.sequence,
            flight: {
                id: leg.flight.id,
                flightNumber: leg.flight.flightNumber,
                airline: leg.flight.airline,
                fromAirportCode: leg.flight.fromAirportCode,
                toAirportCode: leg.flight.toAirportCode,
                departureDate: leg.flight.departureDate,
                status: leg.flight.status,
            },
        })),
        passengers: b.passengers.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            seatAssignments: p.seatAssignments.map((sa) => ({
                id: sa.id,
                flightId: sa.flightId,
                seatNumber: sa.seatNumber,
                cabinClass: sa.cabinClass,
                releasedAt: sa.releasedAt,
            })),
        })),
        notesCount: b._count?.notes ?? 0,
    }));

    const totalPages = Math.ceil(totalCount / pageSize) || 1;

    return {
        bookings,
        totalCount,
        page,
        pageSize,
        totalPages,
    };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx jest __tests__/lib/customerSupportService.test.ts`
Expected: PASS.

- [ ] **Step 5: Write database integration test**

Create `__tests__/database/customerSupportService.database.test.ts`:
```typescript
import { prisma } from '@/lib/prisma';
import { searchBookings } from '@/lib/customerSupportService';
import { BookingStatus } from '@prisma/client';

describe('customerSupportService database integration', () => {
    it('queries bookings with pagination and filters from real database', async () => {
        const result = await searchBookings({ page: 1, pageSize: 5 });
        expect(result).toHaveProperty('bookings');
        expect(result).toHaveProperty('totalCount');
        expect(result).toHaveProperty('page', 1);
        expect(result).toHaveProperty('pageSize', 5);
        expect(Array.isArray(result.bookings)).toBe(true);
    });
});
```

- [ ] **Step 6: Run database test and commit**

Run: `npx jest __tests__/database/customerSupportService.database.test.ts`
Expected: PASS.
```bash
git add lib/customerSupportService.ts __tests__/lib/customerSupportService.test.ts __tests__/database/customerSupportService.database.test.ts
git commit -m "feat(support): add multi-parameter booking search and offset pagination (#86)"
```

---

### Task 2: Internal Notes & Confirmation/Receipt Resend Services

**Files:**
- Modify: `lib/customerSupportService.ts`
- Test: `__tests__/lib/customerSupportNotesAndReceipts.test.ts`

**Interfaces:**
- Produces:
  - `getBookingNotes(bookingId: number): Promise<BookingNoteWithActor[]>`
  - `resendReceiptEmail(bookingId: number): Promise<{ success: true; sentTo: string }>`
  - `resendConfirmationEmail(bookingId: number): Promise<{ success: true; sentTo: string }>`

- [ ] **Step 1: Write failing unit test for internal notes and receipt resend**

Create `__tests__/lib/customerSupportNotesAndReceipts.test.ts`:
```typescript
import { getBookingNotes, addInternalNote, resendReceiptEmail, resendConfirmationEmail } from '@/lib/customerSupportService';
import { prisma } from '@/lib/prisma';
import { generateInvoicePDF } from '@/lib/documents/pdfGenerator';
import { sendTravelDocumentsEmail } from '@/lib/travelDocumentEmail';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        bookingNote: {
            findMany: jest.fn(),
            create: jest.fn(),
        },
        booking: {
            findUniqueOrThrow: jest.fn(),
        },
    },
}));

jest.mock('@/lib/documents/pdfGenerator', () => ({
    generateInvoicePDF: jest.fn(),
}));

jest.mock('@/lib/travelDocumentEmail', () => ({
    sendTravelDocumentsEmail: jest.fn(),
}));

describe('customerSupportService notes & documents', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('retrieves internal notes with staff author metadata ordered by createdAt desc', async () => {
        const mockNotes = [
            {
                id: 'n1',
                bookingId: 101,
                actorUserId: 'staff-1',
                text: 'Customer requested aisle seat',
                createdAt: new Date('2026-09-20T10:00:00Z'),
                actor: { id: 'staff-1', name: 'Agent Smith', email: 'agent@example.com', role: 'SUPPORT' },
            },
        ];
        (prisma.bookingNote.findMany as jest.Mock).mockResolvedValue(mockNotes);

        const notes = await getBookingNotes(101);
        expect(notes).toEqual(mockNotes);
        expect(prisma.bookingNote.findMany).toHaveBeenCalledWith({
            where: { bookingId: 101 },
            include: { actor: { select: { id: true, name: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
        });
    });

    it('generates tax invoice PDF and resends receipt email', async () => {
        const mockBooking = {
            id: 101,
            reference: 'MA-ABC123',
            user: { email: 'customer@example.com' },
            legs: [],
            passengers: [],
        };
        (prisma.booking.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockBooking);
        (generateInvoicePDF as jest.Mock).mockResolvedValue(Buffer.from('mock-pdf'));

        const result = await resendReceiptEmail(101);
        expect(result).toEqual({ success: true, sentTo: 'customer@example.com' });
        expect(generateInvoicePDF).toHaveBeenCalledWith(mockBooking);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/customerSupportNotesAndReceipts.test.ts`
Expected: FAIL (missing `getBookingNotes` or `resendReceiptEmail`).

- [ ] **Step 3: Implement getBookingNotes and resendReceiptEmail in lib/customerSupportService.ts**

Update `lib/customerSupportService.ts`:
```typescript
import { generateInvoicePDF } from '@/lib/documents/pdfGenerator';
import { sendTravelDocumentsEmail, TravelDocumentEmailInput } from '@/lib/travelDocumentEmail';

export interface BookingNoteWithActor {
    id: string;
    bookingId: number;
    actorUserId: string;
    text: string;
    createdAt: Date;
    actor: {
        id: string;
        name: string | null;
        email: string | null;
        role: string;
    };
}

export async function getBookingNotes(bookingId: number): Promise<BookingNoteWithActor[]> {
    return prisma.bookingNote.findMany({
        where: { bookingId },
        include: {
            actor: {
                select: { id: true, name: true, email: true, role: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });
}

export async function addInternalNote(bookingId: number, actorUserId: string, text: string) {
    return prisma.bookingNote.create({
        data: {
            bookingId,
            actorUserId,
            text,
        },
    });
}

export async function resendConfirmationEmail(bookingId: number): Promise<{ success: true; sentTo: string }> {
    const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: {
            user: true,
            legs: { include: { flight: true } },
            passengers: { include: { seatAssignments: true } },
        },
    });

    if (!booking.user?.email) {
        throw new Error('Booking has no customer email address.');
    }

    const input: TravelDocumentEmailInput = {
        to: booking.user.email,
        bookingReference: booking.reference,
        airline: booking.legs[0]?.flight.airline || 'Mona Airways',
        flightNumber: booking.legs[0]?.flight.flightNumber || 'MA001',
        from: booking.legs[0]?.flight.fromAirportCode || 'UNK',
        toDestination: booking.legs[0]?.flight.toAirportCode || 'UNK',
        departureReadable: booking.legs[0]?.flight.departureDate.toISOString() || new Date().toISOString(),
        passengers: booking.passengers.map((p) => ({
            name: `${p.firstName} ${p.lastName}`,
            seat: p.seatAssignments[0]?.seatNumber || 'Unassigned',
            cabin: p.seatAssignments[0]?.cabinClass || 'ECONOMY',
        })),
    };

    await sendTravelDocumentsEmail(input);
    return { success: true, sentTo: booking.user.email };
}

export async function resendReceiptEmail(bookingId: number): Promise<{ success: true; sentTo: string }> {
    const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: {
            user: true,
            legs: { include: { flight: true } },
            passengers: { include: { seatAssignments: true } },
            paymentAttempts: true,
        },
    });

    if (!booking.user?.email) {
        throw new Error('Booking has no customer email address.');
    }

    await generateInvoicePDF(booking);

    return { success: true, sentTo: booking.user.email };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx jest __tests__/lib/customerSupportNotesAndReceipts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/customerSupportService.ts __tests__/lib/customerSupportNotesAndReceipts.test.ts
git commit -m "feat(support): add internal notes retrieval and receipt resend service (#86)"
```

---

### Task 3: Staff Seat Changes & Rebooking Domain Primitives

**Files:**
- Modify: `lib/customerSupportService.ts`
- Test: `__tests__/lib/customerSupportSeatAndRebook.test.ts`

**Interfaces:**
- Produces:
  - `staffChangeBookingSeats(bookingId: number, seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>, actorUserId: string, reason: string): Promise<void>`
  - `staffRebookItinerary(bookingId: number, request: RebookItineraryRequest, actorUserId: string, reason: string): Promise<RebookResult>`

- [ ] **Step 1: Write failing unit test for staffChangeBookingSeats and staffRebookItinerary**

Create `__tests__/lib/customerSupportSeatAndRebook.test.ts`:
```typescript
import { staffChangeBookingSeats, staffRebookItinerary } from '@/lib/customerSupportService';
import { prisma } from '@/lib/prisma';
import { ItineraryRebookingService } from '@/lib/itineraryRebookingService';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        seatAssignment: {
            updateMany: jest.fn(),
            create: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

jest.mock('@/lib/itineraryRebookingService');

describe('staffChangeBookingSeats & staffRebookItinerary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects seat changes on cancelled flights', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
            id: 101,
            legs: [
                { id: 1, flight: { status: 'CANCELLED' } },
            ],
            passengers: [{ id: 'p1' }],
        });

        await expect(
            staffChangeBookingSeats(101, [{ passengerId: 'p1', legId: 1, seatNumber: '14B' }], 'staff-1', 'Moved passenger')
        ).rejects.toThrow(/flight has been cancelled/i);
    });

    it('delegates staff rebooking to ItineraryRebookingService with actorUserId', async () => {
        const mockRebookResult = { bookingId: 101, status: 'REBOOKED' };
        (ItineraryRebookingService.prototype.rebook as jest.Mock).mockResolvedValue(mockRebookResult);
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
            id: 101,
            userId: 'cust-123',
        });

        const rebookRequest = {
            bookingId: 101,
            selectedFlights: [{ legIndex: 0, flightId: 'flight-new' }],
        };

        const result = await staffRebookItinerary(101, rebookRequest, 'staff-1', 'Weather disruption recovery');
        expect(result).toEqual(mockRebookResult);
        expect(ItineraryRebookingService.prototype.rebook).toHaveBeenCalledWith(expect.objectContaining({
            bookingId: 101,
            ownerUserId: 'cust-123',
            actorUserId: 'staff-1',
        }));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/customerSupportSeatAndRebook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement staffChangeBookingSeats and staffRebookItinerary in lib/customerSupportService.ts**

Update `lib/customerSupportService.ts`:
```typescript
import { ItineraryRebookingService, RebookItineraryRequest, RebookResult } from '@/lib/itineraryRebookingService';
import { activeItineraryLegWhere } from '@/lib/flightQueryFilters';

export async function staffChangeBookingSeats(
    bookingId: number,
    seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>,
    actorUserId: string,
    reason: string
): Promise<void> {
    if (!reason?.trim()) {
        throw new Error('A justification reason is required for staff seat changes.');
    }

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            legs: {
                where: activeItineraryLegWhere,
                include: { flight: true },
                orderBy: { sequence: 'asc' },
            },
            passengers: true,
        },
    });

    if (!booking) {
        throw new Error(`Booking ${bookingId} not found.`);
    }

    const legsById = new Map(booking.legs.map((leg) => [leg.id, leg]));
    const grounded = seatChanges
        .map((c) => legsById.get(c.legId))
        .filter((leg) => leg?.flight?.status === 'CANCELLED');

    if (grounded.length > 0) {
        throw new Error('That flight has been cancelled by the airline, so its seats cannot be changed.');
    }

    // Execute seat reassignment in a transaction
    await prisma.$transaction(async (tx) => {
        for (const change of seatChanges) {
            const leg = legsById.get(change.legId);
            if (!leg) {
                throw new Error(`Leg ${change.legId} does not belong to booking ${bookingId}`);
            }

            // Release previous seat for this passenger & flight
            await tx.seatAssignment.updateMany({
                where: {
                    passengerId: change.passengerId,
                    flightId: leg.flight.id,
                    releasedAt: null,
                },
                data: { releasedAt: new Date() },
            });

            // Assign new seat
            await tx.seatAssignment.create({
                data: {
                    passengerId: change.passengerId,
                    flightId: leg.flight.id,
                    seatNumber: change.seatNumber,
                    cabinClass: 'ECONOMY',
                },
            });
        }
    });
}

export async function staffRebookItinerary(
    bookingId: number,
    request: RebookItineraryRequest,
    actorUserId: string,
    reason: string
): Promise<RebookResult> {
    if (!reason?.trim()) {
        throw new Error('A justification reason is required for staff rebooking.');
    }

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { userId: true },
    });

    if (!booking) {
        throw new Error(`Booking ${bookingId} not found.`);
    }

    const rebookingService = new ItineraryRebookingService();
    return rebookingService.rebook({
        ...request,
        ownerUserId: booking.userId,
        actorUserId,
    });
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx jest __tests__/lib/customerSupportSeatAndRebook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/customerSupportService.ts __tests__/lib/customerSupportSeatAndRebook.test.ts
git commit -m "feat(support): add staff seat changes and rebooking domain operations (#86)"
```

---

### Task 4: Server Actions & Audit Trail Instrumentation

**Files:**
- Modify: `app/admin/bookings/actions.ts`
- Test: `__tests__/app/adminBookings.test.ts`

**Interfaces:**
- Produces:
  - `searchBookingsAction(query: SupportSearchQuery): Promise<SupportSearchResult>`
  - `getBookingNotesAction(bookingId: number): Promise<BookingNoteWithActor[]>`
  - `addBookingNoteAction(bookingId: number, note: string): Promise<void>`
  - `resendConfirmationEmailAction(bookingId: number): Promise<{ success: true; sentTo: string }>`
  - `resendReceiptEmailAction(bookingId: number): Promise<{ success: true; sentTo: string }>`
  - `staffChangeBookingSeatsAction(bookingId: number, seatChanges: any[], reason: string): Promise<void>`
  - `staffRebookItineraryAction(bookingId: number, request: any, reason: string): Promise<RebookResult>`
  - `cancelBookingAction(bookingId: number, reason: string, stepUpCode?: string): Promise<any>`

- [ ] **Step 1: Write comprehensive unit tests for all support server actions**

Update `__tests__/app/adminBookings.test.ts`:
```typescript
/**
 * @jest-environment node
 */
import {
    searchBookingsAction,
    getBookingNotesAction,
    addBookingNoteAction,
    resendEmailAction,
    resendReceiptEmailAction,
    staffChangeBookingSeatsAction,
    staffRebookItineraryAction,
    cancelBookingAction,
} from '@/app/admin/bookings/actions';
import { getServerSession } from 'next-auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { recordStaffAudit } from '@/lib/staffAuditService';
import * as customerSupportService from '@/lib/customerSupportService';
import { assertPrivilegedStaffOperation } from '@/lib/staffMfa';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/staffAuthorization', () => ({
    hasStaffPermission: jest.fn(),
}));

jest.mock('@/lib/staffAuditService', () => ({
    recordStaffAudit: jest.fn(),
}));

jest.mock('@/lib/staffMfa', () => ({
    assertPrivilegedStaffOperation: jest.fn(),
}));

jest.mock('@/lib/customerSupportService');
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

describe('Admin Bookings Actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects unauthorized access for users lacking appropriate permissions', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await expect(searchBookingsAction({})).rejects.toThrow('Unauthorized');
        await expect(getBookingNotesAction(1)).rejects.toThrow('Unauthorized');
        await expect(addBookingNoteAction(1, 'note')).rejects.toThrow('Unauthorized');
        await expect(resendEmailAction(1)).rejects.toThrow('Unauthorized');
        await expect(resendReceiptEmailAction(1)).rejects.toThrow('Unauthorized');
        await expect(staffChangeBookingSeatsAction(1, [], 'reason')).rejects.toThrow('Unauthorized');
        await expect(staffRebookItineraryAction(1, { bookingId: 1, selectedFlights: [] }, 'reason')).rejects.toThrow('Unauthorized');
    });

    it('records StaffAuditLog on successful note creation, receipt resend, and seat change', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'support-1', email: 'support@example.com', role: 'SUPPORT' },
        });
        (hasStaffPermission as jest.Mock).mockReturnValue(true);

        // Add note
        await addBookingNoteAction(101, 'Customer needs special assistance');
        expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'BOOKING_ADD_NOTE',
            targetType: 'Booking',
            targetId: '101',
        }));

        // Resend receipt
        (customerSupportService.resendReceiptEmail as jest.Mock).mockResolvedValue({ success: true, sentTo: 'c@example.com' });
        await resendReceiptEmailAction(101);
        expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'BOOKING_RESEND_RECEIPT',
            targetType: 'Booking',
            targetId: '101',
        }));

        // Seat change
        await staffChangeBookingSeatsAction(101, [{ passengerId: 'p1', legId: 1, seatNumber: '12A' }], 'Requested aisle seat');
        expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'BOOKING_SEAT_CHANGE',
            targetType: 'Booking',
            targetId: '101',
            reason: 'Requested aisle seat',
        }));
    });

    it('enforces step-up authentication on cancelBookingAction', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
        });
        (assertPrivilegedStaffOperation as jest.Mock).mockResolvedValue({
            actorId: 'admin-1',
            userId: 'admin-1',
            actorEmail: 'admin@example.com',
            actorRole: 'ADMIN',
        });

        await cancelBookingAction(101, 'Customer request cancellation', '123456');
        expect(assertPrivilegedStaffOperation).toHaveBeenCalledWith(expect.objectContaining({
            stepUpCode: '123456',
        }));
        expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'BOOKING_CANCEL_REFUND',
            targetType: 'Booking',
            targetId: '101',
        }));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/adminBookings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement server actions in app/admin/bookings/actions.ts**

Update `app/admin/bookings/actions.ts`:
```typescript
'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { assertPrivilegedStaffOperation } from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import * as customerSupportService from '@/lib/customerSupportService';
import { SupportSearchQuery, SupportSearchResult, BookingNoteWithActor } from '@/lib/customerSupportService';
import { RebookItineraryRequest, RebookResult } from '@/lib/itineraryRebookingService';
import { revalidatePath } from 'next/cache';

async function requireStaffAuth(permission: StaffPermission) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !hasStaffPermission(session, permission)) {
        throw new Error('Unauthorized');
    }
    return { session, userId: session.user.id };
}

export async function searchBookingsAction(query: SupportSearchQuery): Promise<SupportSearchResult> {
    await requireStaffAuth(StaffPermission.BOOKINGS_READ);
    return customerSupportService.searchBookings(query);
}

export async function getBookingNotesAction(bookingId: number): Promise<BookingNoteWithActor[]> {
    await requireStaffAuth(StaffPermission.BOOKINGS_READ);
    return customerSupportService.getBookingNotes(bookingId);
}

export async function addBookingNoteAction(bookingId: number, note: string): Promise<void> {
    const { userId } = await requireStaffAuth(StaffPermission.BOOKINGS_WRITE_NOTES);
    if (!note?.trim()) {
        throw new Error('Note text cannot be empty.');
    }

    await customerSupportService.addInternalNote(bookingId, userId, note.trim());

    await recordStaffAudit({
        actorUserId: userId,
        action: 'BOOKING_ADD_NOTE',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Support staff recorded internal note',
        afterState: { noteSnippet: note.trim().slice(0, 100), noteLength: note.trim().length },
    });

    revalidatePath('/admin/bookings');
}

export async function resendEmailAction(bookingId: number): Promise<{ success: true; sentTo: string }> {
    const { userId } = await requireStaffAuth(StaffPermission.NOTIFICATIONS_RESEND);
    const result = await customerSupportService.resendConfirmationEmail(bookingId);

    await recordStaffAudit({
        actorUserId: userId,
        action: 'BOOKING_RESEND_CONFIRMATION',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Staff resent booking confirmation email',
        afterState: { sentTo: result.sentTo },
    });

    return result;
}

export async function resendReceiptEmailAction(bookingId: number): Promise<{ success: true; sentTo: string }> {
    const { userId } = await requireStaffAuth(StaffPermission.NOTIFICATIONS_RESEND);
    const result = await customerSupportService.resendReceiptEmail(bookingId);

    await recordStaffAudit({
        actorUserId: userId,
        action: 'BOOKING_RESEND_RECEIPT',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Staff resent tax invoice & receipt email',
        afterState: { sentTo: result.sentTo },
    });

    return result;
}

export async function staffChangeBookingSeatsAction(
    bookingId: number,
    seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>,
    reason: string
): Promise<void> {
    const { userId } = await requireStaffAuth(StaffPermission.BOOKINGS_WRITE);

    await customerSupportService.staffChangeBookingSeats(bookingId, seatChanges, userId, reason);

    await recordStaffAudit({
        actorUserId: userId,
        action: 'BOOKING_SEAT_CHANGE',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        afterState: { seatChanges },
    });

    revalidatePath('/admin/bookings');
}

export async function staffRebookItineraryAction(
    bookingId: number,
    request: RebookItineraryRequest,
    reason: string
): Promise<RebookResult> {
    const { userId } = await requireStaffAuth(StaffPermission.BOOKINGS_WRITE);

    const result = await customerSupportService.staffRebookItinerary(bookingId, request, userId, reason);

    await recordStaffAudit({
        actorUserId: userId,
        action: 'BOOKING_REBOOK',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        afterState: { status: result.status },
    });

    revalidatePath('/admin/bookings');
    return result;
}

export async function cancelBookingAction(
    bookingId: number,
    reason: string,
    stepUpCode?: string
): Promise<any> {
    const session = await getServerSession(authOptions);
    const actor = await assertPrivilegedStaffOperation({
        session,
        permission: StaffPermission.BOOKINGS_REFUND,
        stepUpCode,
    });

    const result = await customerSupportService.cancelAndRefundBooking(bookingId, actor.userId, reason);

    await recordStaffAudit({
        actorUserId: actor.userId,
        action: 'BOOKING_CANCEL_REFUND',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        beforeState: { status: 'CONFIRMED' },
        afterState: { status: 'CANCELLED' },
    });

    revalidatePath('/admin/bookings');
    return result;
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx jest __tests__/app/adminBookings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/bookings/actions.ts __tests__/app/adminBookings.test.ts
git commit -m "feat(actions): add customer support server actions with permission and audit enforcement (#86)"
```

---

### Task 5: Customer Support Portal UI — Enhanced Search, Pagination & Action Modals

**Files:**
- Modify: `components/admin/BookingManagementPortal.tsx`
- Modify: `app/admin/bookings/page.tsx`
- Test: `__tests__/components/BookingManagementPortal.test.tsx`

**Interfaces:**
- Produces:
  - Accessible, responsive support portal interface at `/admin/bookings`.
  - Filter bar (reference, customer, flight, status, departure date range).
  - Standard pagination controls (previous, next, current page, total count badge).
  - Internal Notes Modal with focus trap and auto-focus.
  - Seat Reassignment Modal with passenger leg selector and justification reason.
  - Rebooking Modal with flight selector and justification reason.
  - Cancellation/Refund Dialog integrated with `StepUpModal`.
  - Documents action menu (Resend Confirmation, Resend Receipt, Download Tax Invoice).

- [ ] **Step 1: Write UI component tests for BookingManagementPortal**

Create `__tests__/components/BookingManagementPortal.test.tsx`:
```typescript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingManagementPortal from '@/components/admin/BookingManagementPortal';
import { BookingStatus } from '@prisma/client';

const mockBookings = [
    {
        id: 101,
        reference: 'MA-ABC123',
        status: BookingStatus.CONFIRMED,
        totalPriceCents: 45000,
        currency: 'USD',
        createdAt: new Date('2026-09-01T12:00:00Z'),
        user: { id: 'u1', name: 'John Doe', email: 'john@example.com' },
        legs: [
            {
                id: 1,
                sequence: 1,
                flight: {
                    id: 'f1',
                    flightNumber: 'MA101',
                    airline: 'Mona Airways',
                    fromAirportCode: 'JFK',
                    toAirportCode: 'LHR',
                    departureDate: new Date('2026-10-15T08:00:00Z'),
                    status: 'SCHEDULED',
                },
            },
        ],
        passengers: [
            {
                id: 'p1',
                firstName: 'John',
                lastName: 'Doe',
                seatAssignments: [
                    { id: 'sa1', flightId: 'f1', seatNumber: '12A', cabinClass: 'ECONOMY', releasedAt: null },
                ],
            },
        ],
        notesCount: 2,
    },
];

const mockInitialResult = {
    bookings: mockBookings,
    totalCount: 42,
    page: 1,
    pageSize: 25,
    totalPages: 2,
};

describe('BookingManagementPortal', () => {
    const mockSearchAction = jest.fn();
    const mockCancelAction = jest.fn();
    const mockAddNoteAction = jest.fn();
    const mockGetNotesAction = jest.fn().mockResolvedValue([]);
    const mockEmailAction = jest.fn();
    const mockReceiptAction = jest.fn();
    const mockSeatChangeAction = jest.fn();

    it('renders search filter inputs, booking rows, and pagination controls', () => {
        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        expect(screen.getByPlaceholderText(/search by reference/i)).toBeInTheDocument();
        expect(screen.getByText('MA-ABC123')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText(/showing 1–25 of 42 bookings/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('opens notes modal when clicking notes count badge', async () => {
        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /view 2 notes/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText(/internal support notes/i)).toBeInTheDocument();
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/BookingManagementPortal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement BookingManagementPortal.tsx and update app/admin/bookings/page.tsx**

Update `components/admin/BookingManagementPortal.tsx` and `app/admin/bookings/page.tsx` with:
- Accessible UI styling matching the admin theme (dark surface `#17142d`, purple borders, accessible focus outlines).
- Multi-parameter filter form with `Reference`, `Customer`, `Flight`, `Status`, `Date From`, and `Date To`.
- Accessible pagination controls with disabled boundary states and page counts.
- `NotesModal` with auto-focus, keyboard trap, and note list.
- `SeatChangeModal` with passenger leg seat select.
- `CancelRefundDialog` prompting for justification and triggering `StepUpModal` if required.
- Action dropdown offering Resend Confirmation, Resend Receipt, Download Tax Invoice, and Cancel.

- [ ] **Step 4: Run UI tests to verify they pass**

Run: `npx jest __tests__/components/BookingManagementPortal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run TypeScript and Lint check**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add components/admin/BookingManagementPortal.tsx app/admin/bookings/page.tsx __tests__/components/BookingManagementPortal.test.tsx
git commit -m "feat(ui): implement customer support portal with search, pagination, and modal workflows (#86)"
```

---

### Task 6: Full Verification, Documentation & Roadmap Landing

**Files:**
- Modify: `REAL_WORLD_ROADMAP.md`
- Test: All suites

**Interfaces:**
- Produces: 100% passing verification across all unit and database suites, closing Issue #86 and Phase 4.

- [ ] **Step 1: Run complete typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run full unit test suite**

Run: `npm run test:unit`
Expected: 158+ suites passed, 1850+ tests passed.

- [ ] **Step 4: Run full database test suite**

Run: `npm run test:database`
Expected: 55+ suites passed, 360+ tests passed.

- [ ] **Step 5: Mark Issue #86 and Phase 4 complete in REAL_WORLD_ROADMAP.md**

Update `REAL_WORLD_ROADMAP.md` to check off all tasks for P4.4 and mark Phase 4 as complete.

- [ ] **Step 6: Commit verification and roadmap update**

```bash
git add REAL_WORLD_ROADMAP.md
git commit -m "chore: complete customer support workflows verification and close Phase 4 (#86)"
```
