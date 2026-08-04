/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import FlightBookingService from '@/lib/FlightBookingService';

/**
 * Every traveller holds a seat assignment on every leg of their booking.
 *
 * The read paths carried a fallback to `Passenger.seatNumber` for bookings
 * taken before #118 backfilled `SeatAssignment`. Removing that fallback is only
 * safe if the invariant actually holds, so it is asserted here rather than
 * assumed -- against the whole table, not just rows this test creates (#137).
 */
const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

afterAll(async () => {
    for (const bookingId of created.bookingIds) {
        await prisma.passenger.deleteMany({ where: { bookingId } });
        await prisma.booking.deleteMany({ where: { id: bookingId } });
    }
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('seat assignment coverage', () => {
    it('leaves no passenger without an assignment on any leg of their booking', async () => {
        const orphans = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*)::bigint AS count
            FROM "Passenger" p
            JOIN "ItineraryLeg" l ON l."bookingId" = p."bookingId"
            LEFT JOIN "SeatAssignment" sa
                ON sa."passengerId" = p.id AND sa."legId" = l.id
            WHERE sa.id IS NULL
        `;

        // If this ever fails, the fallbacks removed in #137 were load-bearing
        // and something stopped writing an assignment.
        expect(Number(orphans[0].count)).toBe(0);
    });

    it('records one assignment per leg for a booking taken now', async () => {
        const suffix = `${Date.now()}`;
        const legs = await Promise.all([1, 2].map(async (n) => {
            const flight = await prisma.flight.create({
                data: {
                    flightNumber: `COV-${suffix}-${n}`,
                    airline: 'Mona Airways',
                    from: n === 1 ? 'Seattle, USA' : 'Detroit, USA',
                    to: n === 1 ? 'Detroit, USA' : 'Seattle, USA',
                    departureDate: new Date(`2028-0${n}-01T08:00:00Z`),
                    priceCents: 35_000,
                    status: 'ON_TIME',
                    economyRows: 20,
                    premiumEconomyRows: 4,
                    businessRows: 3,
                    firstClassRows: 3,
                    seatPattern: 'ABC-DEF',
                },
            });
            created.flightIds.push(flight.id);
            return flight;
        }));

        const user = await prisma.user.create({
            data: {
                name: 'Coverage',
                email: `coverage-${suffix}@example.com`,
                password: 'not-used',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(user.id);

        const booking = await new FlightBookingService().bookFlight({
            flightIds: legs.map(leg => leg.id),
            userId: user.id,
            passengers: [
                {
                    firstName: 'Ada', lastName: 'Lovelace',
                    dateOfBirth: new Date('1990-01-01'), passportNumber: 'US1112223',
                    gender: 'Female', seatNumbers: ['11A', '12C'], cabinClass: 'ECONOMY',
                },
                {
                    firstName: 'Grace', lastName: 'Hopper',
                    dateOfBirth: new Date('1985-05-05'), passportNumber: 'US4445556',
                    gender: 'Female', seatNumbers: ['11B', '12D'], cabinClass: 'ECONOMY',
                },
            ],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        const assignments = await prisma.seatAssignment.findMany({
            where: { leg: { bookingId: booking.id } },
        });

        // Two travellers, two legs: four assignments, no leg left to a fallback.
        expect(assignments).toHaveLength(4);
        expect(new Set(assignments.map(a => a.passengerId)).size).toBe(2);
        expect(new Set(assignments.map(a => a.legId)).size).toBe(2);
    });
});
