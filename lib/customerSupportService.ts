import { prisma } from '@/lib/prisma';
import { BookingStatus } from '@prisma/client';
import { sendTravelDocumentsEmail, TravelDocumentEmailInput } from '@/lib/travelDocumentEmail';
import { heldSeats } from '@/lib/seatOccupancy';
// We need formatting functions but can just mock the email input for now or fetch basic data.

import { Prisma } from '@prisma/client';

export async function searchBookings(query: {
    reference?: string;
    emailOrName?: string;
    flightNumber?: string;
    status?: BookingStatus;
}) {
    const where: Prisma.BookingWhereInput = {};

    if (query.reference) {
        where.reference = { contains: query.reference, mode: 'insensitive' };
    }
    if (query.status) {
        where.status = query.status;
    }
    if (query.emailOrName) {
        where.user = {
            OR: [
                { email: { contains: query.emailOrName, mode: 'insensitive' } },
                { name: { contains: query.emailOrName, mode: 'insensitive' } },
            ],
        };
    }
    if (query.flightNumber) {
        where.legs = {
            some: {
                flight: {
                    flightNumber: { contains: query.flightNumber, mode: 'insensitive' },
                },
            },
        };
    }

    return prisma.booking.findMany({
        where,
        include: {
            user: true,
            legs: {
                include: { flight: true },
                orderBy: { sequence: 'asc' },
            },
            passengers: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
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

export async function resendConfirmationEmail(bookingId: number) {
    const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: {
            user: true,
            legs: { include: { flight: true } },
            passengers: { include: { seatAssignments: true } },
        },
    });

    if (!booking.user?.email) {
        throw new Error('Booking has no user email associated with it.');
    }

    // This is a minimal mock for the email input. In reality, you'd map this carefully.
    const input: TravelDocumentEmailInput = {
        to: booking.user.email,
        bookingReference: booking.reference,
        airline: booking.legs[0]?.flight.airline || 'Mona Airways',
        flightNumber: booking.legs[0]?.flight.flightNumber || 'MA001',
        from: booking.legs[0]?.flight.fromAirportCode || 'UNK',
        toDestination: booking.legs[0]?.flight.toAirportCode || 'UNK',
        departureReadable: booking.legs[0]?.flight.departureDate.toISOString() || new Date().toISOString(),
        passengers: booking.passengers.map(p => ({
            name: `${p.firstName} ${p.lastName}`,
            seat: p.seatAssignments[0]?.seatNumber || 'Unassigned',
            cabin: p.seatAssignments[0]?.cabinClass || 'ECONOMY',
        })),
    };

    await sendTravelDocumentsEmail(input);
}
