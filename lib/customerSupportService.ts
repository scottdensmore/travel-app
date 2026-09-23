import { prisma } from '@/lib/prisma';
import { BookingStatus, Prisma } from '@prisma/client';
import { sendTravelDocumentsEmail, TravelDocumentEmailInput } from '@/lib/travelDocumentEmail';
import { heldSeats } from '@/lib/seatOccupancy';
import { activeItineraryLegWhere } from '@/lib/bookingItinerary';
import {
    ItineraryRebookingService,
    RebookItineraryInput,
    RebookItineraryResult,
} from '@/lib/itineraryRebookingService';

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

export interface SupportSearchResult extends Array<SupportBookingItem> {
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
        totalPriceCents: b.totalPriceCents ?? 0,
        currency: b.currency,
        createdAt: b.createdAt,
        user: b.user,
        legs: b.legs.map((leg) => ({
            id: leg.id,
            sequence: leg.sequence,
            flight: {
                id: String(leg.flight.id),
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
                flightId: String(sa.flightId),
                seatNumber: sa.seatNumber,
                cabinClass: sa.cabinClass,
                releasedAt: sa.releasedAt,
            })),
        })),
        notesCount: b._count?.notes ?? 0,
    }));

    const totalPages = Math.ceil(totalCount / pageSize) || 1;

    return Object.assign([...bookings], {
        bookings,
        totalCount,
        page,
        pageSize,
        totalPages,
    });
}

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

export async function cancelAndRefundBooking(bookingId: number, actorUserId: string, reason: string) {
    // 1. Fetch booking to verify it's valid
    const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
    });

    if (booking.status === BookingStatus.CANCELLED) {
        throw new Error('Booking is already cancelled.');
    }

    // 2. Perform the cancellation via a transaction
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
            SELECT set_config('app.booking_status_reason', ${reason}, true)
        `;
        await tx.$executeRaw`
            SELECT set_config('app.booking_status_actor', ${actorUserId}, true)
        `;

        const updatedBooking = await tx.booking.update({
            where: { id: bookingId },
            data: { status: BookingStatus.CANCELLED },
        });

        // Release seats
        await tx.seatAssignment.updateMany({
            where: heldSeats({
                passenger: { bookingId },
            }),
            data: { releasedAt: new Date() },
        });

        return updatedBooking;
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
        },
    });

    if (!booking.user?.email) {
        throw new Error('Booking has no customer email address.');
    }

    const { generateInvoicePDF } = await import('@/lib/documents/pdfGenerator');
    await generateInvoicePDF(booking);

    return { success: true, sentTo: booking.user.email };
}

export type RebookItineraryRequest = Record<string, unknown>;
export type RebookResult = RebookItineraryResult | { status: string; [key: string]: unknown };

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
                    legId: leg.id,
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
        bookingId,
        ownerUserId: booking.userId ?? undefined,
        actorUserId,
    } as unknown as RebookItineraryInput);
}

