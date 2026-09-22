/** @jest-environment node */
import { getFlightOnTimeAnalytics } from '@/lib/flightAnalyticsService';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';

const createdFlightIds: number[] = [];

afterAll(async () => {
    if (createdFlightIds.length > 0) {
        await prisma.flight.deleteMany({ where: { id: { in: createdFlightIds } } });
    }
    await prisma.$disconnect();
});

describe('flightAnalyticsService database integration', () => {
    it('aggregates real flights stored in PostgreSQL database', async () => {
        const referenceDate = new Date('2026-07-15T12:00:00Z');
        const pastDate1 = new Date('2026-06-10T10:00:00Z');
        const pastDate2 = new Date('2026-06-20T14:00:00Z');

        const f1 = await prisma.flight.create({
            data: {
                flightNumber: `FA-${Date.now()}-1`,
                airline: 'Mona Airways',
                ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
                departureDate: pastDate1,
                priceCents: 30000,
                status: 'ON_TIME',
            },
        });
        createdFlightIds.push(f1.id);

        const f2 = await prisma.flight.create({
            data: {
                flightNumber: `FA-${Date.now()}-2`,
                airline: 'Mona Airways',
                ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
                departureDate: pastDate2,
                priceCents: 30000,
                status: 'DELAYED',
            },
        });
        createdFlightIds.push(f2.id);

        const result = await getFlightOnTimeAnalytics({ referenceDate, months: 3 });

        expect(result.source).toBe('OPERATIONAL_DATABASE');
        expect(result.isSample).toBe(false);
        expect(result.totalCompletedFlights).toBeGreaterThanOrEqual(2);

        const jun = result.data.find(d => d.name === 'Jun 2026');
        expect(jun).toBeDefined();
        expect(jun!.totalFlights).toBeGreaterThanOrEqual(2);
    });
});
