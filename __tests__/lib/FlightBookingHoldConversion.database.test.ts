/** @jest-environment node */
import { randomUUID } from 'crypto';
import FlightBookingService from '@/lib/FlightBookingService';
import { airportCodesForRoute } from '@/lib/airports';
import { checkoutHolderKey, consumeSeatHold, holdSeat } from '@/lib/seatHolds';
import { prisma } from '@/lib/prisma';

const created = {
    flightIds: [] as number[],
    userIds: [] as string[],
    bookingIds: [] as number[],
};

async function fixture() {
    const suffix = randomUUID();
    const user = await prisma.user.create({
        data: {
            name: 'Hold Conversion',
            email: `hold-conversion-${suffix}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `CNV-${suffix.slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            priceCents: 30_000,
            firstClassRows: 0,
            businessRows: 0,
            premiumEconomyRows: 0,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
        },
    });
    created.userIds.push(user.id);
    created.flightIds.push(flight.id);
    return { user, flight };
}

function request(userId: string, flightId: number, idempotencyKey: string, seatNumbers: string[]) {
    return {
        flightIds: [flightId],
        userId,
        passengers: seatNumbers.map((seatNumber, index) => ({
            firstName: `Traveller${index}`,
            lastName: 'Example',
            dateOfBirth: '1990-01-01',
            passportNumber: `PASS${index}12345`,
            gender: 'Other',
            seatNumbers: [seatNumber],
            cabinClass: 'ECONOMY',
        })),
        idempotencyKey,
    };
}

afterAll(async () => {
    await prisma.seatHold.deleteMany({ where: { flightId: { in: created.flightIds } } });
    await prisma.passenger.deleteMany({
        where: { booking: { userId: { in: created.userIds } } },
    });
    await prisma.booking.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('converting checkout holds into seat assignments', () => {
    it('consumes the live hold atomically and still accepts an idempotent retry', async () => {
        const { user, flight } = await fixture();
        const idempotencyKey = randomUUID();
        const holderKey = checkoutHolderKey(user.id, idempotencyKey);
        await holdSeat({ flightId: flight.id, seatNumber: '11A', holderKey });

        const service = new FlightBookingService();
        const bookingRequest = request(user.id, flight.id, idempotencyKey, ['11A']);
        const first = await service.bookFlight(bookingRequest);
        created.bookingIds.push(first.id);

        expect(first.wasCreated).toBe(true);
        expect(await prisma.seatHold.count({
            where: { flightId: flight.id, seatNumber: '11A' },
        })).toBe(0);
        expect(await prisma.seatAssignment.count({
            where: { flightId: flight.id, seatNumber: '11A', releasedAt: null },
        })).toBe(1);
        expect(await holdSeat({
            flightId: flight.id,
            seatNumber: '11A',
            holderKey: checkoutHolderKey(user.id, randomUUID()),
        })).toBe(false);
        expect(await prisma.seatHold.count({
            where: { flightId: flight.id, seatNumber: '11A' },
        })).toBe(0);

        const retry = await service.bookFlight(bookingRequest);
        expect(retry).toMatchObject({ id: first.id, wasCreated: false });
    });

    it('rolls earlier hold consumption back when any requested hold is missing', async () => {
        const { user, flight } = await fixture();
        const idempotencyKey = randomUUID();
        const holderKey = checkoutHolderKey(user.id, idempotencyKey);
        await holdSeat({ flightId: flight.id, seatNumber: '12A', holderKey });

        await expect(new FlightBookingService().bookFlight(
            request(user.id, flight.id, idempotencyKey, ['12A', '12B']),
        )).rejects.toThrow('Seat 12B is no longer held for this checkout.');

        expect(await prisma.seatHold.count({
            where: { flightId: flight.id, seatNumber: '12A', holderKey },
        })).toBe(1);
        expect(await prisma.booking.count({
            where: { userId: user.id, idempotencyKey },
        })).toBe(0);
        expect(await prisma.seatAssignment.count({ where: { flightId: flight.id } })).toBe(0);
    });

    it('will not convert another checkout\'s live hold', async () => {
        const { user, flight } = await fixture();
        const idempotencyKey = randomUUID();
        const rivalHolderKey = checkoutHolderKey(user.id, randomUUID());
        await holdSeat({ flightId: flight.id, seatNumber: '13A', holderKey: rivalHolderKey });

        await expect(new FlightBookingService().bookFlight(
            request(user.id, flight.id, idempotencyKey, ['13A']),
        )).rejects.toThrow('Seat 13A is no longer held for this checkout.');

        expect(await prisma.seatHold.findFirst({
            where: { flightId: flight.id, seatNumber: '13A' },
        })).toMatchObject({ holderKey: rivalHolderKey });
    });

    it('does not treat transaction-start time as the hold liveness time', async () => {
        const { user, flight } = await fixture();
        const idempotencyKey = randomUUID();
        const holderKey = checkoutHolderKey(user.id, idempotencyKey);
        await holdSeat({ flightId: flight.id, seatNumber: '14A', holderKey });
        await prisma.$executeRaw`
            UPDATE "SeatHold"
            SET "createdAt" = statement_timestamp(),
                "expiresAt" = statement_timestamp() + interval '500 milliseconds'
            WHERE "flightId" = ${flight.id} AND "seatNumber" = '14A'
        `;

        const consumed = await prisma.$transaction(async (tx) => {
            // Establish the transaction timestamp while the hold is live, then
            // let it expire before conversion checks it. PostgreSQL now() stays
            // fixed at this first statement; statement time does not.
            await tx.$queryRaw`SELECT now()`;
            await tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.75)`;
            return consumeSeatHold(tx, {
                flightId: flight.id,
                seatNumber: '14A',
                holderKey,
            });
        });

        expect(consumed).toBe(false);
        expect(await prisma.seatHold.count({
            where: { flightId: flight.id, seatNumber: '14A', holderKey },
        })).toBe(1);
    });
});
