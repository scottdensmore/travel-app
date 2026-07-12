/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminFlightsTable from '@/app/admin/flights/AdminFlightsTable';

// Mock useRouter from next/navigation
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        refresh: mockRefresh,
    }),
}));

// Mock the status selector/action if needed
jest.mock('@/app/actions', () => ({
    updateFlightStatusAction: jest.fn(),
}));

const mockFlights = [
    {
        id: 1,
        flightNumber: 'FL101',
        airline: 'Test Airlines',
        from: 'JFK',
        to: 'LAX',
        departureDate: '2026-06-20T10:00:00.000Z',
        price: '$200',
        status: 'ON_TIME',
        bookings: [
            {
                id: 10,
                createdAt: '2026-06-18T10:00:00.000Z',
                status: 'CONFIRMED',
                totalPrice: '$200',
                passengers: [
                    {
                        id: 'p1',
                        firstName: 'John',
                        lastName: 'Doe',
                        dateOfBirth: '1990-01-01T00:00:00.000Z',
                        passportNumber: 'P123',
                        gender: 'M',
                        seatNumber: '12A',
                        cabinClass: 'ECONOMY',
                    }
                ]
            },
            {
                id: 11,
                createdAt: '2026-06-18T11:00:00.000Z',
                status: 'CANCELLED',
                totalPrice: '$200',
                passengers: [
                    {
                        id: 'p2',
                        firstName: 'Jane',
                        lastName: 'Smith',
                        dateOfBirth: '1992-02-02T00:00:00.000Z',
                        passportNumber: 'P456',
                        gender: 'F',
                        seatNumber: 'CANCELLED-12B',
                        cabinClass: 'BUSINESS',
                    }
                ]
            }
        ]
    },
    {
        id: 2,
        flightNumber: 'FL202',
        airline: 'Another Airlines',
        from: 'SFO',
        to: 'SEA',
        departureDate: '2026-06-21T12:00:00.000Z',
        price: '$150',
        status: 'DELAYED',
        bookings: []
    }
];

describe('AdminFlightsTable', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the table headers and flight rows correctly', () => {
        render(<AdminFlightsTable initialFlights={mockFlights} />);

        // Check columns headers
        expect(screen.getByText('Flight')).toBeInTheDocument();
        expect(screen.getByText('Route')).toBeInTheDocument();
        expect(screen.getByText('Departure Date')).toBeInTheDocument();
        expect(screen.getByText('Price')).toBeInTheDocument();
        expect(screen.getByText('Bookings (Active/Cancelled)')).toBeInTheDocument();
        expect(screen.getByText('Occupancy (Seats Booked)')).toBeInTheDocument();

        // Check flight rows basic info
        expect(screen.getByText('Test Airlines')).toBeInTheDocument();
        expect(screen.getByText('FL101')).toBeInTheDocument();
        expect(screen.getByText('JFK → LAX')).toBeInTheDocument();
        expect(screen.getByText('$200')).toBeInTheDocument();

        expect(screen.getByText('Another Airlines')).toBeInTheDocument();
        expect(screen.getByText('FL202')).toBeInTheDocument();
        expect(screen.getByText('SFO → SEA')).toBeInTheDocument();
        expect(screen.getByText('$150')).toBeInTheDocument();
    });

    it('calculates and displays booking stats and occupancy rates correctly', () => {
        render(<AdminFlightsTable initialFlights={mockFlights} />);

        // Flight 1: 1 Active, 1 Cancelled
        expect(screen.getByText('1 Active')).toBeInTheDocument();
        expect(screen.getByText('(1 Cancelled)')).toBeInTheDocument();
        
        // Flight 1 Occupancy: 1 active passenger out of 180 (0.6% full)
        expect(screen.getByText('1 / 180')).toBeInTheDocument();
        expect(screen.getByText('0.6% full')).toBeInTheDocument();

        // Flight 2: 0 Active, no Cancelled text
        expect(screen.getByText('0 Active')).toBeInTheDocument();
        
        // Flight 2 Occupancy: 0 / 180 (0.0% full)
        expect(screen.getByText('0 / 180')).toBeInTheDocument();
        expect(screen.getByText('0.0% full')).toBeInTheDocument();
    });

    it('shows no flight message when the flight list is empty', () => {
        render(<AdminFlightsTable initialFlights={[]} />);

        expect(screen.getByText('No active flight instances generated for the next 7 days.')).toBeInTheDocument();
    });

    it('opens passenger manifest modal with correct detailed stats and records when Manifest button is clicked', () => {
        render(<AdminFlightsTable initialFlights={mockFlights} />);

        const manifestButtons = screen.getAllByRole('button', { name: 'Manifest' });
        expect(manifestButtons).toHaveLength(2);

        // Click the first flight's manifest button
        fireEvent.click(manifestButtons[0]);

        // Modal should appear
        expect(screen.getByText('Passenger Manifest')).toBeInTheDocument();
        expect(screen.getByText(/Test Airlines FL101 \| JFK → LAX/i)).toBeInTheDocument();

        // Manifest Stats summary
        expect(screen.getByText('Total Booked')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        
        const confirmedLabels = screen.getAllByText('Confirmed');
        expect(confirmedLabels.length).toBeGreaterThanOrEqual(2);
        
        const cancelledLabels = screen.getAllByText('Cancelled');
        expect(cancelledLabels.length).toBeGreaterThanOrEqual(2);

        // Let's assert confirmed/cancelled counts. Since there's '1 Active' and '(1 Cancelled)', we can verify count number exists
        // Confirm text is '1' under Confirmed and '1' under Cancelled
        const numericValues = screen.getAllByText('1');
        expect(numericValues.length).toBeGreaterThanOrEqual(2);

        // Passenger rows in table
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('M')).toBeInTheDocument();
        expect(screen.getByText('P123')).toBeInTheDocument();
        expect(screen.getByText('ECONOMY')).toBeInTheDocument();
        expect(screen.getByText('Seat 12A')).toBeInTheDocument();
        
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('F')).toBeInTheDocument();
        expect(screen.getByText('P456')).toBeInTheDocument();
        expect(screen.getByText('BUSINESS')).toBeInTheDocument();
        expect(screen.getByText('Released')).toBeInTheDocument();

        // Status column labels
        const confirmedBadges = screen.getAllByText('Confirmed');
        expect(confirmedBadges.length).toBeGreaterThanOrEqual(1); // includes header/row
        const cancelledBadges = screen.getAllByText('Cancelled');
        expect(cancelledBadges.length).toBeGreaterThanOrEqual(1); // includes header/row

        // Close the modal via Close button
        const closeBtn = screen.getByRole('button', { name: 'Close' });
        fireEvent.click(closeBtn);

        // Modal should be gone
        expect(screen.queryByText('Passenger Manifest')).not.toBeInTheDocument();
    });

    it('opens passenger manifest modal with empty message for flight with no bookings', () => {
        render(<AdminFlightsTable initialFlights={mockFlights} />);

        const manifestButtons = screen.getAllByRole('button', { name: 'Manifest' });
        // Click the second flight's manifest button (index 1)
        fireEvent.click(manifestButtons[1]);

        expect(screen.getByText('Passenger Manifest')).toBeInTheDocument();
        expect(screen.getByText(/Another Airlines FL202 \| SFO → SEA/i)).toBeInTheDocument();

        // Empty message
        expect(screen.getByText('No passengers booked on this occurrence.')).toBeInTheDocument();

        // Close via ✕ button
        const closeCross = screen.getByRole('button', { name: '✕' });
        fireEvent.click(closeCross);

        expect(screen.queryByText('Passenger Manifest')).not.toBeInTheDocument();
    });
});
