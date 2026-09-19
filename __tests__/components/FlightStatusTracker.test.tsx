import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightStatusTracker from '@/components/ui/FlightStatusTracker';
import { searchFlightStatusAction } from '@/app/actions';

jest.mock('@/app/actions', () => ({
    searchFlightStatusAction: jest.fn(),
}));

const mockFlightResult = {
    id: 101,
    flightNumber: 'MA101',
    airline: 'Mona Airways',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    fromAirportCode: 'SEA',
    toAirportCode: 'DTW',
    departureDate: '2026-08-10T14:00:00.000Z',
    durationMinutes: 240,
    durationFormatted: '4h 00m',
    status: 'ON_TIME' as const,
    phase: 'BOARDING' as const,
    delayReason: null,
    estimatedDeparture: null,
    actualDeparture: null,
    estimatedArrival: null,
    actualArrival: null,
    departure: { date: '2026-08-10', time: '07:00', readableDate: 'Aug 10, 2026', zoneLabel: 'PDT' },
    arrival: { date: '2026-08-10', time: '14:00', readableDate: 'Aug 10, 2026', zoneLabel: 'EDT', dayOffset: 0 },
    gates: { departureTerminal: '1', departureGate: 'A8', arrivalTerminal: 'Evans', arrivalGate: 'D14' },
};

const mockDelayedFlightResult = {
    ...mockFlightResult,
    id: 102,
    flightNumber: 'MA102',
    status: 'DELAYED' as const,
    phase: 'DELAYED' as const,
    delayReason: 'Maintenance check required',
};

describe('FlightStatusTracker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders search mode tabs and toggles between them', () => {
        render(<FlightStatusTracker initialFlights={[]} initialSearch={null} coverage="today" />);
        const flightNumberTab = screen.getByRole('tab', { name: /by flight number/i });
        const routeTab = screen.getByRole('tab', { name: /by route/i });

        expect(flightNumberTab).toBeInTheDocument();
        expect(routeTab).toBeInTheDocument();
        expect(flightNumberTab).toHaveAttribute('aria-selected', 'true');
        expect(routeTab).toHaveAttribute('aria-selected', 'false');

        expect(screen.getByLabelText(/flight number/i)).toBeInTheDocument();

        fireEvent.click(routeTab);
        expect(routeTab).toHaveAttribute('aria-selected', 'true');
        expect(flightNumberTab).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByLabelText(/origin airport/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/destination airport/i)).toBeInTheDocument();
    });

    it('renders detailed flight card with progress and gate information', () => {
        render(
            <FlightStatusTracker
                initialFlights={[mockFlightResult]}
                initialSearch={{ mode: 'flightNumber', flightNumber: 'MA101' }}
                coverage="today"
            />
        );

        expect(screen.getByText('MA101')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways')).toBeInTheDocument();
        expect(screen.getByText(/now boarding/i)).toBeInTheDocument();
        expect(screen.getByText(/Gate A8/i)).toBeInTheDocument();
        expect(screen.getByText(/Gate D14/i)).toBeInTheDocument();
        expect(screen.getByText(/Terminal 1/i)).toBeInTheDocument();
        expect(screen.getByText(/Terminal Evans/i)).toBeInTheDocument();
        expect(screen.getByText(/4h 00m/i)).toBeInTheDocument();
        expect(screen.getByText(/07:00 PDT/i)).toBeInTheDocument();
        expect(screen.getByText(/14:00 EDT/i)).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /book/i })).toBeInTheDocument();
    });

    it('displays delay banner when flight is delayed', () => {
        render(
            <FlightStatusTracker
                initialFlights={[mockDelayedFlightResult]}
                initialSearch={{ mode: 'flightNumber', flightNumber: 'MA102' }}
                coverage="today"
            />
        );

        expect(screen.getByText('MA102')).toBeInTheDocument();
        expect(screen.getByText(/^Delayed$/i)).toBeInTheDocument();
        expect(screen.getByText(/Maintenance check required/i)).toBeInTheDocument();
    });

    it('performs search by flight number and updates URL and results', async () => {
        const pushStateSpy = jest.spyOn(window.history, 'pushState');
        (searchFlightStatusAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: [mockFlightResult],
        });

        render(<FlightStatusTracker initialFlights={[]} initialSearch={null} coverage="today" />);

        const flightInput = screen.getByLabelText(/flight number/i);
        fireEvent.change(flightInput, { target: { value: 'MA101' } });

        const searchButton = screen.getByRole('button', { name: /search/i });
        fireEvent.click(searchButton);

        await waitFor(() => {
            expect(searchFlightStatusAction).toHaveBeenCalledWith({
                mode: 'flightNumber',
                flightNumber: 'MA101',
            });
        });

        expect(pushStateSpy).toHaveBeenCalledWith(
            null,
            '',
            expect.stringContaining('/flight-status?flight=MA101')
        );

        await waitFor(() => {
            expect(screen.getByText('MA101')).toBeInTheDocument();
        });

        pushStateSpy.mockRestore();
    });

    it('performs search by route and updates URL and results', async () => {
        const pushStateSpy = jest.spyOn(window.history, 'pushState');
        (searchFlightStatusAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: [mockFlightResult],
        });

        render(<FlightStatusTracker initialFlights={[]} initialSearch={null} coverage="today" />);

        fireEvent.click(screen.getByRole('tab', { name: /by route/i }));

        const originInput = screen.getByLabelText(/origin airport/i);
        const destinationInput = screen.getByLabelText(/destination airport/i);

        fireEvent.change(originInput, { target: { value: 'SEA' } });
        fireEvent.change(destinationInput, { target: { value: 'DTW' } });

        const searchButton = screen.getByRole('button', { name: /search/i });
        fireEvent.click(searchButton);

        await waitFor(() => {
            expect(searchFlightStatusAction).toHaveBeenCalledWith({
                mode: 'route',
                from: 'SEA',
                to: 'DTW',
            });
        });

        expect(pushStateSpy).toHaveBeenCalledWith(
            null,
            '',
            expect.stringContaining('/flight-status?from=SEA&to=DTW')
        );

        await waitFor(() => {
            expect(screen.getByText('MA101')).toBeInTheDocument();
        });

        pushStateSpy.mockRestore();
    });

    it('displays error message when search returns error', async () => {
        (searchFlightStatusAction as jest.Mock).mockResolvedValue({
            ok: false,
            error: { code: 'SERVER_ERROR', message: 'Flight not found.' },
        });

        render(<FlightStatusTracker initialFlights={[]} initialSearch={null} coverage="today" />);

        const flightInput = screen.getByLabelText(/flight number/i);
        fireEvent.change(flightInput, { target: { value: 'UNKNOWN' } });

        const searchButton = screen.getByRole('button', { name: /search/i });
        fireEvent.click(searchButton);

        await waitFor(() => {
            expect(screen.getByText(/Flight not found/i)).toBeInTheDocument();
        });
    });

    it('displays empty state when search finds no flights', async () => {
        (searchFlightStatusAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: [],
        });

        render(<FlightStatusTracker initialFlights={[]} initialSearch={null} coverage="today" />);

        const flightInput = screen.getByLabelText(/flight number/i);
        fireEvent.change(flightInput, { target: { value: 'MA999' } });

        const searchButton = screen.getByRole('button', { name: /search/i });
        fireEvent.click(searchButton);

        await waitFor(() => {
            expect(screen.getByText(/No flights found/i)).toBeInTheDocument();
        });
    });

    it('pre-fills form inputs and sets active tab when initialSearch is provided', () => {
        render(
            <FlightStatusTracker
                initialFlights={[]}
                initialSearch={{ mode: 'route', from: 'SEA', to: 'DTW', date: '2026-08-10' }}
                coverage="today"
            />
        );

        const routeTab = screen.getByRole('tab', { name: /by route/i });
        expect(routeTab).toHaveAttribute('aria-selected', 'true');

        expect(screen.getByLabelText(/origin airport/i)).toHaveValue('SEA');
        expect(screen.getByLabelText(/destination airport/i)).toHaveValue('DTW');
        expect(screen.getByLabelText(/departure date/i)).toHaveValue('2026-08-10');
    });

    it.each([
        ['UPCOMING', 'ON_TIME', 'On Time'],
        ['DEPARTED', 'ON_TIME', 'Departed'],
        ['ARRIVED', 'ON_TIME', 'Arrived'],
        ['CANCELLED', 'CANCELLED', 'Cancelled'],
    ] as const)('renders appropriate badge for phase %s and status %s', (phase, status, expectedBadgeText) => {
        const flight = {
            ...mockFlightResult,
            id: 200,
            phase,
            status,
        };

        render(<FlightStatusTracker initialFlights={[flight]} initialSearch={null} coverage="today" />);
        expect(screen.getByText(expectedBadgeText)).toBeInTheDocument();
    });

    it('renders actual and estimated departure and arrival times when present', () => {
        const operationalFlight = {
            ...mockFlightResult,
            id: 201,
            phase: 'DEPARTED' as const,
            actualDeparture: '2026-08-10T14:15:00.000Z',
            estimatedArrival: '2026-08-10T18:20:00.000Z',
        };

        render(<FlightStatusTracker initialFlights={[operationalFlight]} initialSearch={null} coverage="today" />);

        expect(screen.getByText(/Actual:/i)).toBeInTheDocument();
        expect(screen.getByText(/07:15 PDT/i)).toBeInTheDocument();
        expect(screen.getByText(/Estimated:/i)).toBeInTheDocument();
        expect(screen.getByText(/14:20 EDT/i)).toBeInTheDocument();
    });
});
