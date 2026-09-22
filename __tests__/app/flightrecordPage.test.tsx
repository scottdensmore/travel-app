jest.mock('@/lib/prisma', () => ({
    prisma: {
        flight: {
            findMany: jest.fn(),
        },
    },
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import FlightRecordPage from '@/app/flightrecord/page';
import FlightRecordChart from '@/app/flightrecord/FlightRecordChart';
import type { FlightOnTimeAnalyticsResult } from '@/lib/flightAnalyticsService';
import { getFlightOnTimeAnalytics } from '@/lib/flightAnalyticsService';

jest.mock('@/lib/flightAnalyticsService');

// Mock recharts responsive container / svg dimensions for test environment
jest.mock('recharts', () => {
    const OriginalModule = jest.requireActual('recharts');
    return {
        ...OriginalModule,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
            <div data-testid="responsive-container">{children}</div>
        ),
    };
});

describe('FlightRecordChart & OnTimeLineChart', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders operational data source badge and freshness when operational data is provided', () => {
        const operationalAnalytics: FlightOnTimeAnalyticsResult = {
            data: [
                { name: 'May 2026', ontimepercent: 95, totalFlights: 100, ontimeCount: 95 },
                { name: 'Jun 2026', ontimepercent: 98, totalFlights: 120, ontimeCount: 118 },
            ],
            source: 'OPERATIONAL_DATABASE',
            sourceLabel: 'Operational flight records from Mona Airways departures',
            isSample: false,
            freshness: '2026-06-22T10:00:00.000Z',
            totalCompletedFlights: 220,
        };

        render(<FlightRecordChart analytics={operationalAnalytics} />);

        expect(screen.getByText('On Time Percentage')).toBeInTheDocument();
        expect(screen.getByText('Operational Flight Data')).toBeInTheDocument();
        expect(screen.getByText(/Operational flight records from Mona Airways departures/i)).toBeInTheDocument();
        expect(screen.getByText(/220 completed flights analyzed/i)).toBeInTheDocument();
    });

    it('renders sample demonstration data badge when fallback sample data is provided', () => {
        const sampleAnalytics: FlightOnTimeAnalyticsResult = {
            data: [
                { name: 'Jan', ontimepercent: 97 },
                { name: 'Feb', ontimepercent: 96 },
            ],
            source: 'SAMPLE_DATA',
            sourceLabel: 'Sample demonstration data (no historical completed flights found in database)',
            isSample: true,
            freshness: '2026-06-22T10:00:00.000Z',
            totalCompletedFlights: 0,
        };

        render(<FlightRecordChart analytics={sampleAnalytics} />);

        expect(screen.getByText('Sample Demonstration Data')).toBeInTheDocument();
        expect(screen.getByText(/Sample demonstration data \(no historical completed flights/i)).toBeInTheDocument();
    });

    it('renders FlightRecordPage server component by fetching analytics', async () => {
        (getFlightOnTimeAnalytics as jest.Mock).mockResolvedValueOnce({
            data: [{ name: 'Jan 2026', ontimepercent: 99, totalFlights: 50, ontimeCount: 49 }],
            source: 'OPERATIONAL_DATABASE',
            sourceLabel: 'Operational flight records from Mona Airways departures',
            isSample: false,
            freshness: '2026-01-31T23:59:59.000Z',
            totalCompletedFlights: 50,
        });

        const pageElement = await FlightRecordPage();
        render(pageElement);

        expect(screen.getByText('Operational Flight Data')).toBeInTheDocument();
        expect(screen.getByText(/50 completed flights analyzed/i)).toBeInTheDocument();
    });
});
