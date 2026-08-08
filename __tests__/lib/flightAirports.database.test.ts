/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';

/**
 * A flight points at the airports it touches, and they agree with the labels it
 * renders.
 *
 * `from` and `to` are free text that is both the identity of a place and the
 * words shown to a customer, so editing the prose silently repointed the route
 * and nothing stopped a flight naming somewhere no airport exists. This is the
 * first of two steps: the references are here and filled, the reads still use
 * the labels, and dropping the labels is the second step (#73).
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

    it('names the same place twice, never two different ones', async () => {
        // Not merely "the column is filled": filled with the wrong airport
        // would satisfy NOT NULL and the foreign key both.
        const disagreements = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*)::bigint AS count
            FROM "Flight" f
            JOIN "Airport" origin ON origin."iataCode" = f."fromAirportCode"
            JOIN "Airport" destination ON destination."iataCode" = f."toAirportCode"
            WHERE (origin."label" <> f."from" AND f."from" NOT LIKE '%Atlantis')
               OR (destination."label" <> f."to" AND f."to" NOT LIKE '%Atlantis')
              -- The route-render suites write rows that break this on purpose:
              -- disagreeing columns are the only way to prove which source a
              -- page read. Excluded so an interrupted run leaves a stray
              -- fixture rather than a failure in a file that never mentions it
              -- (#155).
              --
              -- Keyed to the sentinel place rather than to a flight-number
              -- prefix: flightNumber has no format rule, so exempting RTE-%
              -- would have left a namespace an administrator could occupy and
              -- this invariant would then never check. No real row can name
              -- Atlantis -- airportCodeFor refuses it at every writer.
        `;

        expect(Number(disagreements[0].count)).toBe(0);
    });

    it('refuses a flight pointing at an airport that does not exist', async () => {
        await expect(prisma.$executeRawUnsafe(
            `INSERT INTO "Flight" ("flightNumber", "airline", "from", "to",
                                   "fromAirportCode", "toAirportCode", "departureDate", "priceCents")
             VALUES ($1, 'Mona Airways', 'Seattle, USA', 'Detroit, USA', 'ZZZ', 'DTW', $2, 35000)`,
            `FA-${randomUUID()}`, new Date('2028-07-01T08:00:00Z'),
        )).rejects.toThrow(/foreign key constraint/i);
    });

    it('refuses a flight that names no airport at all', async () => {
        await expect(prisma.$executeRawUnsafe(
            `INSERT INTO "Flight" ("flightNumber", "airline", "from", "to", "departureDate", "priceCents")
             VALUES ($1, 'Mona Airways', 'Seattle, USA', 'Detroit, USA', $2, 35000)`,
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
                from: 'Seattle, USA',
                to: 'Detroit, USA',
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
