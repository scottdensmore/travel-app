/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
    prisma: { flight: { findMany: jest.fn() } },
}));

import { prisma } from '@/lib/prisma';
import FlightsPage from '@/app/flights/page';

const findMany = prisma.flight.findMany as unknown as jest.Mock;

/**
 * The status board asked for every flight ever scheduled and serialized the lot
 * into the RSC payload on every request — 1420 rows against the current seed,
 * spanning a year either side of today, on a page that answers "is my flight on
 * time" (#153).
 */
describe('flight status board page', () => {
    beforeEach(() => {
        findMany.mockReset();
        findMany.mockResolvedValue([]);
    });

    const queryArgs = async () => {
        await FlightsPage();
        expect(findMany).toHaveBeenCalledTimes(1);
        return findMany.mock.calls[0][0];
    };

    it('asks for a window around now rather than the whole table', async () => {
        const before = Date.now();
        const { where } = await queryArgs();
        const after = Date.now();

        const { gte, lte } = where.departureDate;
        expect(gte).toBeInstanceOf(Date);
        expect(lte).toBeInstanceOf(Date);

        // Opens in the past, so a flight that has just left is still answerable,
        // and closes in the future.
        expect(gte.getTime()).toBeLessThan(before);
        expect(lte.getTime()).toBeGreaterThan(after);

        // Bounded on both sides: a window measured in days, not the 15 months
        // the seeded table spans.
        const spanDays = (lte.getTime() - gte.getTime()) / 86_400_000;
        expect(spanDays).toBeLessThanOrEqual(10);
    });

    it('caps how many rows it will serialize even inside that window', async () => {
        // The window bounds the query against today's data; `take` is what
        // keeps a denser schedule from reintroducing the same defect.
        const { take } = await queryArgs();

        expect(take).toBeGreaterThan(0);
        expect(take).toBeLessThanOrEqual(200);
    });

    it('reads the soonest departures first, so the cap drops the furthest away', async () => {
        const { orderBy } = await queryArgs();

        expect(orderBy).toEqual({ departureDate: 'asc' });
    });

    it('asks only for the columns the board renders', async () => {
        const { select } = await queryArgs();

        expect(Object.keys(select).sort()).toEqual([
            'airline', 'departureDate', 'flightNumber', 'from', 'id', 'priceCents', 'status', 'to',
        ]);
        // The cabin row counts and seat pattern are a third of what remains
        // once the window has done its work, and nothing here reads them.
        for (const unused of ['seatPattern', 'economyRows', 'businessRows', 'firstClassRows', 'premiumEconomyRows']) {
            expect(select).not.toHaveProperty(unused);
        }
    });

    describe('the range it tells the board it covers', () => {
        const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i }));

        it('describes the whole window when everything fits', async () => {
            findMany.mockResolvedValue(rows(3));

            const { coverage } = (await FlightsPage()).props;

            expect(coverage).toBe('the last 2 hours and the next 7 days');
        });

        it('counts departures instead of days when the cap truncates', async () => {
            // Otherwise the board promises a week it does not hold, and a
            // search for a day-six flight fails against a line saying day seven
            // is covered — the defect this copy exists to prevent, moved.
            findMany.mockResolvedValue(rows(200));

            const { coverage } = (await FlightsPage()).props;

            expect(coverage).toBe('the last 2 hours and the next 200 flights');
            expect(coverage).not.toContain('days');
        });

        it('states a duration rather than dates, which the rows would contradict', async () => {
            // The rows format themselves in the viewer's timezone, so an
            // absolute range stated here sat above rows dated a day either side
            // of it. Displaying flight times correctly is #84.
            findMany.mockResolvedValue(rows(3));

            const { coverage } = (await FlightsPage()).props;

            expect(coverage).not.toMatch(/\d{4}/);
            expect(coverage).toMatch(/^the last /);
        });
    });
});
