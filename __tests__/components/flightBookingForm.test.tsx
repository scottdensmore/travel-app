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

const routes = [
    { from: 'Seattle, USA', to: 'Detroit, USA' },
    { from: 'Seattle, USA', to: 'Tokyo, Japan' },
    { from: 'New York, USA', to: 'London, UK' },
];

const mockFlights = [
    {
        id: 1,
        flightNumber: 'CA101',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15',
        returnDate: null,
        price: '$350',
    },
];

const renderForm = () => render(<FlightBookingForm routes={routes} />);

describe('FlightBookingForm', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders origins and the destinations reachable from the default origin', () => {
        renderForm();
        expect(screen.getByText('Where Your Journey Takes Flight')).toBeInTheDocument();
        // Origins (distinct departure cities)
        expect(screen.getByRole('option', { name: 'Seattle, USA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'New York, USA' })).toBeInTheDocument();
        // Destinations for the default origin (Seattle)
        expect(screen.getByRole('option', { name: 'Detroit, USA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Tokyo, Japan' })).toBeInTheDocument();
        // London is only reachable from New York, so it must not appear yet
        expect(screen.queryByRole('option', { name: 'London, UK' })).not.toBeInTheDocument();
    });

    it('updates the destination options when the origin changes', () => {
        renderForm();
        fireEvent.change(screen.getByLabelText('From'), { target: { value: 'New York, USA' } });
        expect(screen.getByRole('option', { name: 'London, UK' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Detroit, USA' })).not.toBeInTheDocument();
    });

    it('searches using the selected origin and destination', async () => {
        mockSearch.mockResolvedValue(mockFlights);

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
            expect(screen.getByText('CA101')).toBeInTheDocument();
        });
        // Defaults to the first origin and its first reachable destination.
        expect(mockSearch).toHaveBeenCalledWith('Seattle, USA', 'Detroit, USA', expect.any(String));
    });

    it('shows a no-results message when no flights match the route', async () => {
        mockSearch.mockResolvedValue([]);

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText(/No flights found/i)).toBeInTheDocument();
        });
        expect(screen.queryByText('Available Flights')).not.toBeInTheDocument();
    });

    it('books a flight via bookFlightAction when "Book Now" is clicked', async () => {
        mockSearch.mockResolvedValue(mockFlights);
        mockBook.mockResolvedValue({ id: 999 });

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Book Now'));

        await waitFor(() => {
            expect(mockBook).toHaveBeenCalledTimes(1);
            expect(mockBook).toHaveBeenCalledWith({ flightId: 1 });
            expect(screen.getByText(/Successfully booked flight CA101/)).toBeInTheDocument();
        });
    });

    it('handles toggling trip type to one-way, input changes, and error handling', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockSearch.mockRejectedValue(new Error('Search failed'));
        mockBook.mockRejectedValue(new Error('Booking failed'));

        const { container } = renderForm();

        // Test class selection change
        const classSelect = container.querySelector('#class') as HTMLSelectElement;
        fireEvent.change(classSelect, { target: { value: 'business' } });
        expect(classSelect.value).toBe('business');

        // Test departure date change
        const departInput = container.querySelector('#depart') as HTMLInputElement;
        fireEvent.change(departInput, { target: { value: '2026-06-20' } });
        expect(departInput.value).toBe('2026-06-20');

        // Test trip type toggling to one-way
        const oneWayRadio = screen.getByLabelText('One Way');
        fireEvent.click(oneWayRadio);
        
        const returnInput = container.querySelector('#returnDate') as HTMLInputElement;
        expect(returnInput).toBeDisabled();

        // Search error handler check
        fireEvent.click(screen.getByText('Find your trip'));
        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        // Setup mock flights back to test booking error
        mockSearch.mockResolvedValue(mockFlights);
        fireEvent.click(screen.getByText('Find your trip'));
        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Book Now'));
        await waitFor(() => {
            expect(screen.getByText('Failed to book flight. Please try again later.')).toBeInTheDocument();
        });

        // Test changing the destination option explicitly
        const toSelect = container.querySelector('#to') as HTMLSelectElement;
        fireEvent.change(toSelect, { target: { value: 'Tokyo, Japan' } });
        expect(toSelect.value).toBe('Tokyo, Japan');

        consoleErrorSpy.mockRestore();
    });

});

