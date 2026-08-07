/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { heldSeats } from '@/lib/seatOccupancy';

/**
 * One rule: a seat is held unless the booking holding it was cancelled.
 *
 * Four queries asked this — booking a flight, reading a seat map, changing a
 * seat, and editing a cabin layout — and each wrote the condition out again.
 * Three separate issues (#74, #75, #76) are queued to rewrite those same call
 * sites, so the rule is stated once and this proves what it means (#143).
 *
 * Exercised through a real query rather than by inspecting the object, because
 * the object is only interesting insofar as Prisma reads it the intended way.
 */
const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

let flightId: number;
let confirmedSeat: string;
let cancelledSeat: string;

async function bookSeat(status: string, seatNumber: string) {
    const user = await prisma.user.create({
        data: {
            name: 'Occupancy',
            email: `occupancy-${randomUUID()}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            status,
            legs: { create: [{ sequence: 1, flightId }] },
            passengers: {
                create: [{
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    gender: 'Female',
                    sensitiveDataDeletedAt: new Date(),
                }],
            },
        },
        include: { legs: true, passengers: true },
    });
    created.bookingIds.push(booking.id);

    await prisma.seatAssignment.create({
        data: {
            passengerId: booking.passengers[0].id,
            legId: booking.legs[0].id,
            flightId,
            seatNumber,
            cabinClass: 'ECONOMY',
        },
    });

    return booking;
}

beforeAll(async () => {
    const suffix = `${Date.now()}`;
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `OCCUPANCY-${suffix}`,
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: new Date('2028-03-01T08:00:00Z'),
            priceCents: 35_000,
            status: 'ON_TIME',
            economyRows: 20,
            premiumEconomyRows: 4,
            businessRows: 3,
            firstClassRows: 3,
            seatPattern: 'ABC-DEF',
        },
    });
    flightId = flight.id;
    created.flightIds.push(flight.id);

    confirmedSeat = '14A';
    cancelledSeat = '14B';
    await bookSeat('CONFIRMED', confirmedSeat);
    await bookSeat('CANCELLED', cancelledSeat);
});

afterAll(async () => {
    for (const bookingId of created.bookingIds) {
        await prisma.seatAssignment.deleteMany({ where: { leg: { bookingId } } });
        await prisma.itineraryLeg.deleteMany({ where: { bookingId } });
        await prisma.passenger.deleteMany({ where: { bookingId } });
        await prisma.booking.deleteMany({ where: { id: bookingId } });
    }
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('seat occupancy', () => {
    const heldOn = async (where: object = {}) =>
        (await prisma.seatAssignment.findMany({
            where: heldSeats({ flightId, ...where }),
            select: { seatNumber: true },
        })).map(seat => seat.seatNumber).sort();

    it('counts a seat on a live booking as held', async () => {
        expect(await heldOn()).toContain(confirmedSeat);
    });

    it('releases a seat when the booking holding it is cancelled', async () => {
        // The seat row stays — a cancellation is not a deletion — so the
        // predicate is the only thing keeping it out of the seat map.
        const rows = await prisma.seatAssignment.findMany({ where: { flightId, seatNumber: cancelledSeat } });
        expect(rows).toHaveLength(1);

        expect(await heldOn()).not.toContain(cancelledSeat);
    });

    it('composes with a caller\'s own conditions', async () => {
        // Changing a seat asks "held by anyone other than me", so the rule has
        // to survive being applied beside an exclusion.
        const mine = created.bookingIds[0];

        expect(await heldOn({ NOT: { leg: { bookingId: mine } } })).not.toContain(confirmedSeat);
    });

    it('keeps the rule even when a caller passes its own leg filter', async () => {
        // The reason this is a function and not an object to spread: applied
        // last, the rule cannot be erased by a caller's own `leg` key. Spread
        // first, this call would have dropped the booking join entirely and
        // reported the cancelled seat as held.
        const held = await prisma.seatAssignment.findMany({
            where: heldSeats({ flightId, leg: { flightId } }),
            select: { seatNumber: true },
        });

        expect(held.map(seat => seat.seatNumber)).not.toContain(cancelledSeat);
    });
});
