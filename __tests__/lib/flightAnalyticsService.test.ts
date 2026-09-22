/** @jest-environment node */
import { getFlightOnTimeAnalytics } from '@/lib/flightAnalyticsService';
import { prisma } from '@/lib/prisma';
import OnTimeData from '@/lib/data/OnTimeData';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        flight: {
            findMany: jest.fn(),
        },
    },
}));

describe('flightAnalyticsService', () => {
    const mockPrisma = prisma as unknown as {
        flight: {
            findMany: jest.Mock;
        };
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('aggregates real operational flight records by month when completed flights exist', async () => {
        const referenceDate = new Date('2026-06-15T12:00:00Z');
        mockPrisma.flight.findMany.mockResolvedValue([
            {
                departureDate: new Date('2026-05-10T10:00:00Z'),
                status: 'ON_TIME',
            },
            {
                departureDate: new Date('2026-05-12T14:00:00Z'),
                status: 'ON_TIME',
            },
            {
                departureDate: new Date('2026-05-15T18:00:00Z'),
                status: 'DELAYED',
            },
            {
                departureDate: new Date('2026-06-02T08:00:00Z'),
                status: 'ON_TIME',
            },
            {
                departureDate: new Date('2026-06-05T09:00:00Z'),
                status: 'CANCELLED',
            },
        ]);

        const result = await getFlightOnTimeAnalytics({ referenceDate, months: 6 });

        expect(result.isSample).toBe(false);
        expect(result.source).toBe('OPERATIONAL_DATABASE');
        expect(result.sourceLabel).toContain('Operational flight records');
        expect(result.totalCompletedFlights).toBe(5);
        expect(result.freshness).toBeDefined();

        // May 2026: 2 ON_TIME out of 3 total -> 67%
        const may = result.data.find(d => d.name === 'May 2026');
        expect(may).toBeDefined();
        expect(may?.ontimepercent).toBe(67);
        expect(may?.totalFlights).toBe(3);
        expect(may?.ontimeCount).toBe(2);
        expect(may?.delayedCount).toBe(1);
        expect(may?.cancelledCount).toBe(0);

        // Jun 2026: 1 ON_TIME out of 2 total -> 50%
        const jun = result.data.find(d => d.name === 'Jun 2026');
        expect(jun).toBeDefined();
        expect(jun?.ontimepercent).toBe(50);
        expect(jun?.totalFlights).toBe(2);
        expect(jun?.ontimeCount).toBe(1);
        expect(jun?.cancelledCount).toBe(1);
    });

    it('falls back to labeled sample baseline data when no completed flights exist', async () => {
        mockPrisma.flight.findMany.mockResolvedValue([]);

        const result = await getFlightOnTimeAnalytics({
            referenceDate: new Date('2026-06-15T12:00:00Z'),
        });

        expect(result.isSample).toBe(true);
        expect(result.source).toBe('SAMPLE_DATA');
        expect(result.sourceLabel).toContain('Sample demonstration data');
        expect(result.totalCompletedFlights).toBe(0);
        expect(result.data).toHaveLength(OnTimeData.length);
        expect(result.data[0].name).toBe(OnTimeData[0].name);
        expect(result.data[0].ontimepercent).toBe(OnTimeData[0].ontimepercent);
    });
});
