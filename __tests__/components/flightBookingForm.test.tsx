import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightBookingForm from '@/components/ui/flightBookingForm';
import { bookFlightAction } from '@/app/actions';

// Mock the server action
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
}));

describe('FlightBookingForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the generic search form', () => {
        render(<FlightBookingForm />);
        expect(screen.getByText('Where Your Journey Takes Flight')).toBeInTheDocument();
        expect(screen.getByLabelText('From')).toBeInTheDocument();
        expect(screen.getByLabelText('To')).toBeInTheDocument();
        expect(screen.getByText('Find your trip')).toBeInTheDocument();
    });

    it('shows mock flights when searching', async () => {
        render(<FlightBookingForm />);
        fireEvent.click(screen.getByText('Find your trip'));

        expect(screen.getByText('Searching...')).toBeInTheDocument();

        // Wait for the mock API call (1.5s)
        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
            // MA101 is one of the mock flights
            expect(screen.getByText('MA101')).toBeInTheDocument();
        }, { timeout: 2000 });
    });

    it('calls bookFlightAction when a flight is selected', async () => {
        (bookFlightAction as jest.Mock).mockResolvedValue({ id: 999 });

        render(<FlightBookingForm />);

        // Search
        fireEvent.click(screen.getByText('Find your trip'));

        // Wait for results
        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
        }, { timeout: 2000 });

        // Click Select on the first flight
        const selectButtons = screen.getAllByText('Select');
        fireEvent.click(selectButtons[0]);

        // Expect it to say Booking...
        expect(screen.getByText('Booking...')).toBeInTheDocument();

        // Wait for success message
        await waitFor(() => {
            expect(bookFlightAction).toHaveBeenCalledTimes(1);
            expect(bookFlightAction).toHaveBeenCalledWith(expect.objectContaining({
                flightNumber: 'MA101',
                from: 'SFO', // default
                to: 'NYC',   // default
            }));
            expect(screen.getByText(/Successfully booked flight MA101/)).toBeInTheDocument();
        });
    });
});
