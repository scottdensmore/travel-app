/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { CABIN_FARE_PERCENT } from '@/lib/bookingPricing';

/**
 * A cabin is one of four, and the database is what says so.
 *
 * `SeatAssignment.cabinClass` was `TEXT NOT NULL` with no enum and no check
 * constraint, so the only thing keeping a nonsense cabin out of a booking was
 * the Zod schema at the request boundary. Everything reaching the table another
 * way — a repair script, a seed, a future service — could write anything at all,
 * and the seat map, the fare and the boarding pass would all read it back
 * (#73).
 */
const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

let flightId: number;
let legId: number;
let passengerId: string;

beforeAll(async () => {
    const suffix = `${Date.now()}`;
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `CABIN-${suffix}`,
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date('2028-05-01T08:00:00Z'),
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

    const user = await prisma.user.create({
        data: {
            name: 'Cabin',
            email: `cabin-${randomUUID()}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            status: 'CONFIRMED',
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
    legId = booking.legs[0].id;
    passengerId = booking.passengers[0].id;
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

describe('cabin class', () => {
    // Independent of each other: if the first ever stops being refused, its row
    // would otherwise take the traveller's one seat on this leg and fail the
    // second for the wrong reason.
    beforeEach(async () => {
        await prisma.seatAssignment.deleteMany({ where: { legId } });
    });

    it('refuses a cabin that does not exist, whatever wrote it', async () => {
        // Raw SQL on purpose: the point is that the column itself refuses this,
        // not that a Zod schema somewhere upstream would have.
        await expect(prisma.$executeRawUnsafe(
            `INSERT INTO "SeatAssignment" ("id", "passengerId", "legId", "flightId", "seatNumber", "cabinClass")
             VALUES ($1, $2, $3, $4, $5, 'STEERAGE')`,
            randomUUID(), passengerId, legId, flightId, '9Z',
            // Matched, not bare: an unrelated future constraint could reject
            // this insert for a reason that has nothing to do with the cabin.
        )).rejects.toThrow(/invalid input value for enum/);
    });

    it('holds exactly the four labels, in the database itself', async () => {
        // The drift guard elsewhere reads the enum out of the generated client,
        // which is `schema.prisma`. This reads Postgres, so a type that gained
        // a label without the schema saying so is visible too.
        const labels = await prisma.$queryRaw<Array<{ label: string }>>`
            SELECT e.enumlabel AS label
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'CabinClass'
            ORDER BY e.enumsortorder
        `;

        expect(labels.map(row => row.label)).toEqual([
            'ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST',
        ]);
    });

    it('accepts every cabin the application sells', async () => {
        for (const [index, cabin] of Object.keys(CABIN_FARE_PERCENT).entries()) {
            const assignment = await prisma.seatAssignment.create({
                data: {
                    passengerId,
                    legId,
                    flightId,
                    seatNumber: `3${'ABCD'[index]}`,
                    cabinClass: cabin as keyof typeof CABIN_FARE_PERCENT,
                },
            });
            expect(assignment.cabinClass).toBe(cabin);
            // One traveller holds one seat per leg, so make room for the next.
            await prisma.seatAssignment.delete({ where: { id: assignment.id } });
        }
    });
});
