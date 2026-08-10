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
        priceCents: 20000,
        status: 'ON_TIME',
        bookings: [
            {
                id: 10,
                createdAt: '2026-06-18T10:00:00.000Z',
                status: 'CONFIRMED',
                totalPriceCents: 20000,
                passengers: [
                    {
                        id: 'p1',
                        firstName: 'John',
                        lastName: 'Doe',
                        gender: 'M',
                        // The same seat as the released one below, which is now
                        // a state the database allows and the manifest must not
                        // report as two people in 12A (#76).
                        seatNumber: '12A',
                        releasedAt: null,
                        cabinClass: 'ECONOMY',
                    }
                ]
            },
            {
                id: 12,
                createdAt: '2026-06-18T12:00:00.000Z',
                // The airline cancelled this flight, so the booking is
                // disrupted rather than cancelled: the seat is still held and
                // the customer has not decided yet (#76).
                status: 'DISRUPTED',
                totalPriceCents: 20000,
                passengers: [
                    {
                        id: 'p3',
                        firstName: 'Grace',
                        lastName: 'Hopper',
                        gender: 'F',
                        seatNumber: '14B',
                        releasedAt: null,
                        cabinClass: 'ECONOMY',
                    }
                ]
            },
            {
                id: 11,
                createdAt: '2026-06-18T11:00:00.000Z',
                status: 'CANCELLED',
                totalPriceCents: 20000,
                passengers: [
                    {
                        id: 'p2',
                        firstName: 'Jane',
                        lastName: 'Smith',
                        gender: 'F',
                        // A released seat keeps the number the traveller
                        // actually held -- the same 12A the confirmed traveller
                        // above now holds. The manifest has to read the
                        // release, not the number, or it reports two people in
                        // one seat (#76).
                        seatNumber: '12A',
                        releasedAt: new Date('2026-08-09T12:00:00Z'),
                        // A different cabin from the other traveller: the
                        // manifest lists the cabin held on this leg, per
                        // traveller, rather than one cabin for the flight.
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
        priceCents: 15000,
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

        // Flight 1: two bookings still holding seats -- one confirmed, one
        // disrupted by the airline -- and one the customer cancelled. A
        // disrupted booking is counted as active because its seat is genuinely
        // still held (#76).
        expect(screen.getByText('2 Active')).toBeInTheDocument();
        expect(screen.getByText('(1 Cancelled)')).toBeInTheDocument();
        
        // Flight 1 Occupancy: 1 active passenger out of 180 (0.6% full)
        // Two travellers hold seats: the confirmed one and the disrupted one.
        expect(screen.getByText('2 / 180')).toBeInTheDocument();
        expect(screen.getByText('1.1% full')).toBeInTheDocument();

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

        // Manifest Stats summary: three travellers, one in each state.
        expect(screen.getByText('Total Booked')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();

        const confirmedLabels = screen.getAllByText('Confirmed');
        expect(confirmedLabels.length).toBeGreaterThanOrEqual(2);

        const cancelledLabels = screen.getAllByText('Cancelled');
        expect(cancelledLabels.length).toBeGreaterThanOrEqual(2);

        // One under each of Confirmed, Disrupted and Cancelled. Counting
        // everything not cancelled as confirmed reported the disrupted
        // traveller as holding a live seat on a flight the airline had
        // cancelled (#76).
        const numericValues = screen.getAllByText('1');
        expect(numericValues.length).toBeGreaterThanOrEqual(3);

        // Passenger rows in table
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('M')).toBeInTheDocument();
        expect(screen.queryByText('P123')).not.toBeInTheDocument();
        expect(screen.getAllByText('Economy').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Seat 12A')).toBeInTheDocument();
        
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        // Two travellers share a gender cell value now.
        expect(screen.getAllByText('F').length).toBe(2);
        expect(screen.queryByText('P456')).not.toBeInTheDocument();
        expect(screen.queryByText('DOB')).not.toBeInTheDocument();
        expect(screen.queryByText('Passport')).not.toBeInTheDocument();
        expect(screen.getByText('Business')).toBeInTheDocument();
        expect(screen.getByText('Released')).toBeInTheDocument();
        // A disrupted passenger is neither confirmed nor cancelled: staff were
        // told a passenger on a flight the airline had cancelled was
        // "Confirmed", holding a live seat on it (#76).
        // Twice: the tally heading, and the traveller's own status.
        expect(screen.getAllByText('Disrupted').length).toBe(2);
        expect(screen.getByText('Seat 14B')).toBeInTheDocument();

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
        const closeCross = screen.getByRole('button', { name: 'Close passenger manifest' });
        fireEvent.click(closeCross);

        expect(screen.queryByText('Passenger Manifest')).not.toBeInTheDocument();
    });

    it('provides accessible dialog semantics and restores focus when Escape closes the manifest', () => {
        render(<AdminFlightsTable initialFlights={mockFlights} />);

        const trigger = screen.getAllByRole('button', { name: 'Manifest' })[0];
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog', { name: 'Passenger Manifest' });
        const closeButton = screen.getByRole('button', { name: 'Close passenger manifest' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(closeButton).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: 'Passenger Manifest' })).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it('keeps keyboard focus inside the open manifest', () => {
        render(<AdminFlightsTable initialFlights={mockFlights} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Manifest' })[0]);
        const closeButton = screen.getByRole('button', { name: 'Close passenger manifest' });
        const footerCloseButton = screen.getByRole('button', { name: 'Close' });

        footerCloseButton.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(closeButton).toHaveFocus();

        closeButton.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(footerCloseButton).toHaveFocus();
    });
});
