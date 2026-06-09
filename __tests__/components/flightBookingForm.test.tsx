import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightBookingForm from '@/components/ui/flightBookingForm';
import { bookFlightAction, searchFlightsAction } from '@/app/actions';

// The form calls both server actions; mock both (mocking the module also keeps
// the heavy next-auth import chain out of the test).
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
    searchFlightsAction: jest.fn(),
}));

const mockSearch = searchFlightsAction as jest.Mock;
const mockBook = bookFlightAction as jest.Mock;

const mockFlights = [
    {
        id: 1,
        flightNumber: 'MA101',
        airline: 'Mona Air',
        from: 'SFO',
        to: 'NYC',
        departureDate: '2026-03-01',
        returnDate: null,
        price: '$350',
    },
];

describe('FlightBookingForm', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders the generic search form', () => {
        render(<FlightBookingForm />);
        expect(screen.getByText('Where Your Journey Takes Flight')).toBeInTheDocument();
        expect(screen.getByLabelText('From')).toBeInTheDocument();
        expect(screen.getByLabelText('To')).toBeInTheDocument();
        expect(screen.getByText('Find your trip')).toBeInTheDocument();
    });

    it('shows the flights returned by searchFlightsAction', async () => {
        mockSearch.mockResolvedValue(mockFlights);

        render(<FlightBookingForm />);
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
            expect(screen.getByText('MA101')).toBeInTheDocument();
        });
        // Defaults are SFO -> NYC.
        expect(mockSearch).toHaveBeenCalledWith('SFO', 'NYC');
    });

    it('books a flight via bookFlightAction when "Book Now" is clicked', async () => {
        mockSearch.mockResolvedValue(mockFlights);
        mockBook.mockResolvedValue({ id: 999 });

        render(<FlightBookingForm />);
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Book Now'));

        await waitFor(() => {
            expect(mockBook).toHaveBeenCalledTimes(1);
            expect(mockBook).toHaveBeenCalledWith({ flightId: 1 });
            expect(screen.getByText(/Successfully booked flight MA101/)).toBeInTheDocument();
        });
    });
});
