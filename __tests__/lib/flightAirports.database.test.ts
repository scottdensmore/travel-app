/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { FlightData } from '@/lib/data/FlightData';

/**
 * A flight points at the airports it touches, and that is the only place it
 * says where it goes.
 *
 * `from` and `to` were free text that was both the identity of a place and the
 * words shown to a customer, so editing the prose silently repointed the route
 * and nothing stopped a flight naming somewhere no airport exists. The
 * references arrived in #189, the reads moved to them in #197, and this is the
 * step that removes the second answer to the question (#73).
 */
const created = { flightIds: [] as number[] };

afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.$disconnect();
});

describe('flight airports', () => {
    it('scans the rows it claims to scan', async () => {
        // The disagreement count below passes just as happily against an empty
        // table, which is how a whole-table scan quietly stops meaning
        // anything (#155).
        const flights = await prisma.flight.count();

        expect(flights).toBeGreaterThan(0);
    });

    it('has nowhere left to store a route as text', async () => {
        // The invariant this file used to assert -- that the columns agree with
        // the airports -- is gone because the disagreement is now unstateable.
        // That is the whole point of the change, so it is asserted directly
        // rather than left as the absence of a test.
        const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'Flight' AND column_name IN ('from', 'to')
        `;

        expect(columns).toEqual([]);
    });

    it('seeds each flight onto the route its data names', async () => {
        // The columns used to be the cross-check: a whole-table scan asserted
        // they agreed with the airports, so a writer resolving a route to the
        // wrong pair was caught. Removing them removed that, and the seed is
        // the one writer with no unit assertion on its create payload -- so
        // reversing its two arguments went undetected by the entire suite.
        //
        // FlightData is the authored truth here, so it is what the rows are
        // compared against.
        const expected = new Map(FlightData.map((flight) => [
            flight.flightNumber,
            airportCodesForRoute(flight.from, flight.to),
        ]));

        const seeded = await prisma.flight.findMany({
            where: { flightNumber: { in: [...expected.keys()] } },
            select: { flightNumber: true, fromAirportCode: true, toAirportCode: true },
        });

        // A flight number repeats across the occurrences the scheduler
        // generates, so this covers both writers rather than the five legacy
        // rows -- but only if every authored number actually reached the table
        // (#155).
        expect(new Set(seeded.map((flight) => flight.flightNumber)))
            .toEqual(new Set(expected.keys()));
        for (const flight of seeded) {
            expect({ flightNumber: flight.flightNumber, ...expected.get(flight.flightNumber) })
                .toEqual({
                    flightNumber: flight.flightNumber,
                    fromAirportCode: flight.fromAirportCode,
                    toAirportCode: flight.toAirportCode,
                });
        }
    });

    it('refuses a flight pointing at an airport that does not exist', async () => {
        await expect(prisma.$executeRawUnsafe(
            `INSERT INTO "Flight" ("flightNumber", "airline",
                                   "fromAirportCode", "toAirportCode", "departureDate", "priceCents")
             VALUES ($1, 'Mona Airways', 'ZZZ', 'DTW', $2, 35000)`,
            `FA-${randomUUID()}`, new Date('2028-07-01T08:00:00Z'),
        )).rejects.toThrow(/foreign key constraint/i);
    });

    it('refuses a flight that names no airport at all', async () => {
        await expect(prisma.$executeRawUnsafe(
            `INSERT INTO "Flight" ("flightNumber", "airline", "departureDate", "priceCents")
             VALUES ($1, 'Mona Airways', $2, 35000)`,
            `FA-${randomUUID()}`, new Date('2028-07-01T08:00:00Z'),
            // 23502 is the not-null violation. Matched on the SQLSTATE rather
            // than the prose, because Postgres reports the failing row here
            // instead of naming the constraint.
        )).rejects.toThrow(/23502/);
    });

    it('keeps an airport that flights still reference', async () => {
        // ON DELETE RESTRICT: removing a place out from under a sold flight
        // would leave the itinerary describing nowhere.
        const flight = await prisma.flight.create({
            data: {
                flightNumber: `FA-${randomUUID()}`,
                airline: 'Mona Airways',
                ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
                departureDate: new Date('2028-07-02T08:00:00Z'),
                priceCents: 35_000,
            },
        });
        created.flightIds.push(flight.id);

        await expect(
            prisma.airport.delete({ where: { iataCode: 'SEA' } })
        ).rejects.toThrow();
    });
});
