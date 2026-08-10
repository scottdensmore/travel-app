/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { heldSeats } from '@/lib/seatOccupancy';

/**
 * Releasing a seat, and what the index does about it.
 *
 * Cancelling used to overwrite the seat number with `CANCELLED-<passengerId>`,
 * because `UNIQUE (flightId, seatNumber)` could not tell a held seat from a
 * released one and would otherwise hold it forever. The fix for an index that
 * was too strict was to destroy the data it indexed: which seat somebody was in
 * before they cancelled is not recoverable for any booking cancelled before
 * this (#76).
 *
 * A partial unique index says the same thing without the lie -- uniqueness
 * applies to held seats only. These are the two halves of that: the seat can be
 * sold again, and it still cannot be sold twice.
 */
const created = { flightIds: [] as number[], userIds: [] as string[] };

async function aFlight() {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `REL-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
            priceCents: 35_000,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

/** A traveller on a flight, with a leg to sit on and no seat taken yet. */
async function bookingWithoutSeat(flightId: number) {
    const user = await prisma.user.create({
        data: { email: `seat-release-${randomUUID()}@example.com` },
    });
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
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

    return { booking, passengerId: booking.passengers[0].id, legId: booking.legs[0].id };
}

async function seat(flightId: number, seatNumber: string) {
    const user = await prisma.user.create({
        data: { email: `seat-release-${randomUUID()}@example.com` },
    });
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
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

    const assignment = await prisma.seatAssignment.create({
        data: {
            passengerId: booking.passengers[0].id,
            legId: booking.legs[0].id,
            flightId,
            seatNumber,
            cabinClass: 'ECONOMY',
        },
    });

    return { booking, assignment };
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('the seat index', () => {
    it('still refuses to sell one seat to two customers', async () => {
        // The guard the rename existed to satisfy. Losing this would be the
        // worst possible outcome of relaxing the index.
        const flight = await aFlight();
        await seat(flight.id, '9C');

        await expect(seat(flight.id, '9C')).rejects.toThrow(/Unique constraint|duplicate key/i);
    });

    it('lets a released seat be sold again, with its number intact', async () => {
        const flight = await aFlight();
        const first = await seat(flight.id, '9D');

        await prisma.booking.update({
            where: { id: first.booking.id },
            data: { status: 'CANCELLED' },
        });

        // The row still says where they sat. Under the old scheme this read
        // `CANCELLED-<passengerId>` and the seat number was gone for good.
        const released = await prisma.seatAssignment.findUnique({
            where: { id: first.assignment.id },
        });
        expect(released!.seatNumber).toBe('9D');
        expect(released!.releasedAt).toBeInstanceOf(Date);

        const second = await seat(flight.id, '9D');
        expect(second.assignment.seatNumber).toBe('9D');

        // And exactly one of the two is held, which is what the seat map reads.
        const held = await prisma.seatAssignment.findMany({
            where: heldSeats({ flightId: flight.id, seatNumber: '9D' }),
        });
        expect(held.map(row => row.id)).toEqual([second.assignment.id]);
    });

    it('gives a just-released seat to exactly one of two racing customers', async () => {
        // The race this change creates, and the one the index alone answers.
        // `e2e/booking-authority.spec.ts` contests a seat on an empty flight,
        // where the flight lock rejects the loser before any index is
        // consulted -- it would pass with no unique index at all. Here the two
        // inserts reach the index together.
        const flight = await aFlight();
        const first = await seat(flight.id, '9F');
        await prisma.booking.update({
            where: { id: first.booking.id },
            data: { status: 'CANCELLED' },
        });

        const rivals = await Promise.all([bookingWithoutSeat(flight.id), bookingWithoutSeat(flight.id)]);
        const results = await Promise.allSettled(rivals.map(rival =>
            prisma.seatAssignment.create({
                data: {
                    passengerId: rival.passengerId,
                    legId: rival.legId,
                    flightId: flight.id,
                    seatNumber: '9F',
                    cabinClass: 'ECONOMY',
                },
            }),
        ));

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find(result => result.status === 'rejected');
        expect(String((rejected as PromiseRejectedResult).reason))
            .toMatch(/Unique constraint|duplicate key/i);

        // And the released row is still there, still saying where its traveller
        // sat, alongside the one live claim.
        expect(await prisma.seatAssignment.count({
            where: { flightId: flight.id, seatNumber: '9F' },
        })).toBe(2);
        expect(await prisma.seatAssignment.count({
            where: heldSeats({ flightId: flight.id, seatNumber: '9F' }),
        })).toBe(1);
    });

    it('does not let a released seat be sold twice over', async () => {
        const flight = await aFlight();
        const first = await seat(flight.id, '9E');
        await prisma.booking.update({
            where: { id: first.booking.id },
            data: { status: 'CANCELLED' },
        });

        await seat(flight.id, '9E');

        // The partial index applies to whoever holds it now.
        await expect(seat(flight.id, '9E')).rejects.toThrow(/Unique constraint|duplicate key/i);
    });
});

describe('what releases a seat', () => {
    it('cancelling the booking, without the caller having to remember', async () => {
        // Splitting the release out of the status made the two capable of
        // disagreeing. Nothing should be able to reach a cancelled booking that
        // still holds a seat, so the database does it rather than the one
        // caller that knows both facts.
        const flight = await aFlight();
        const { booking, assignment } = await seat(flight.id, '10A');

        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

        const after = await prisma.seatAssignment.findUnique({ where: { id: assignment.id } });
        expect(after!.releasedAt).toBeInstanceOf(Date);
    });

    it('and not a disruption, which keeps the seat until the customer chooses', async () => {
        // A flight the airline cancelled leaves the customer picking between a
        // refund and a rebooking, and the seat is theirs until they do.
        const flight = await aFlight();
        const { booking, assignment } = await seat(flight.id, '10B');

        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });

        const after = await prisma.seatAssignment.findUnique({ where: { id: assignment.id } });
        expect(after!.releasedAt).toBeNull();
        expect(await prisma.seatAssignment.count({
            where: heldSeats({ flightId: flight.id, seatNumber: '10B' }),
        })).toBe(1);
    });

    it('once, keeping the time it was first let go', async () => {
        // Re-cancelling must not move the timestamp: it is the record of when
        // the seat became available, and something else may already have been
        // sold it.
        const flight = await aFlight();
        const { booking, assignment } = await seat(flight.id, '10C');

        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        const firstRelease = (await prisma.seatAssignment.findUnique({
            where: { id: assignment.id },
        }))!.releasedAt;

        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

        const after = await prisma.seatAssignment.findUnique({ where: { id: assignment.id } });
        expect(after!.releasedAt).toEqual(firstRelease);
    });
});
