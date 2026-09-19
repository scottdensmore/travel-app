import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightStatusPage from '@/app/flight-status/page';
import { FlightStatusService } from '@/lib/flightStatusService';
import { serverRenderTime } from '@/lib/serverClock';

jest.mock('@/lib/flightStatusService', () => ({
    FlightStatusService: {
        searchFlightStatus: jest.fn(),
    },
}));

jest.mock('@/lib/serverClock', () => ({
    serverRenderTime: jest.fn(),
}));

jest.mock('@/components/ui/FlightStatusTracker', () => {
    return function MockFlightStatusTracker(props: any) {
        return (
            <div data-testid="mock-flight-status-tracker">
                <div data-testid="initial-search">{JSON.stringify(props.initialSearch)}</div>
                <div data-testid="initial-flights-count">{props.initialFlights.length}</div>
            </div>
        );
    };
});

describe('FlightStatusPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (serverRenderTime as jest.Mock).mockResolvedValue(Date.parse('2026-08-10T12:00:00.000Z'));
    });

    it('renders tracker with empty initial flights when no searchParams are provided', async () => {
        const page = await FlightStatusPage({ searchParams: Promise.resolve({}) });
        render(page);

        expect(screen.getByTestId('mock-flight-status-tracker')).toBeInTheDocument();
        expect(screen.getByTestId('initial-search')).toHaveTextContent('null');
        expect(screen.getByTestId('initial-flights-count')).toHaveTextContent('0');
        expect(FlightStatusService.searchFlightStatus).not.toHaveBeenCalled();
    });

    it('executes search by flight number when flight param is provided', async () => {
        const mockResult = [{ id: 1, flightNumber: 'MA101' }];
        (FlightStatusService.searchFlightStatus as jest.Mock).mockResolvedValue(mockResult);

        const page = await FlightStatusPage({
            searchParams: Promise.resolve({ flight: 'MA101', date: '2026-08-10' }),
        });
        render(page);

        expect(FlightStatusService.searchFlightStatus).toHaveBeenCalledWith(
            { mode: 'flightNumber', flightNumber: 'MA101', date: '2026-08-10' },
            Date.parse('2026-08-10T12:00:00.000Z')
        );
        expect(screen.getByTestId('initial-flights-count')).toHaveTextContent('1');
    });

    it('executes search by route when from and to params are provided', async () => {
        const mockResult = [{ id: 2, flightNumber: 'MA202' }];
        (FlightStatusService.searchFlightStatus as jest.Mock).mockResolvedValue(mockResult);

        const page = await FlightStatusPage({
            searchParams: Promise.resolve({ from: 'SEA', to: 'DTW' }),
        });
        render(page);

        expect(FlightStatusService.searchFlightStatus).toHaveBeenCalledWith(
            { mode: 'route', from: 'SEA', to: 'DTW' },
            Date.parse('2026-08-10T12:00:00.000Z')
        );
        expect(screen.getByTestId('initial-flights-count')).toHaveTextContent('1');
    });

    it('handles service errors gracefully by returning empty initial flights', async () => {
        (FlightStatusService.searchFlightStatus as jest.Mock).mockRejectedValue(new Error('DB error'));

        const page = await FlightStatusPage({
            searchParams: Promise.resolve({ flight: 'MA101' }),
        });
        render(page);

        expect(screen.getByTestId('initial-flights-count')).toHaveTextContent('0');
    });
});
