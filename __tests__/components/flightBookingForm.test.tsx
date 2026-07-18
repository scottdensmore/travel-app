import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightBookingForm from '@/components/ui/flightBookingForm';
import { bookFlightAction, searchFlightsAction } from '@/app/actions';

// Mock server actions
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
    searchFlightsAction: jest.fn(),
}));

const mockSearch = searchFlightsAction as jest.Mock;
const mockBook = bookFlightAction as jest.Mock;

const routes = [
    { from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' },
    { from: 'Seattle, USA', to: 'Tokyo, Japan', nextOperatingDate: '2026-07-16' },
    { from: 'New York, USA', to: 'London, UK', nextOperatingDate: '2026-07-18' },
];

const mockFlights = [
    {
        id: 1,
        flightNumber: 'CA101',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T12:00:00Z',
        returnDate: null,
        price: '$350',
        status: 'ON_TIME',
    },
];

const mockEnhancedFlights = [
    {
        id: 1,
        flightNumber: 'GA101',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T08:00:00Z',
        returnDate: null,
        price: '$200',
        status: 'ON_TIME',
    },
    {
        id: 2,
        flightNumber: 'AA102',
        airline: 'American Airlines',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T12:00:00Z',
        returnDate: null,
        price: '$500',
        status: 'ON_TIME',
    },
    {
        id: 3,
        flightNumber: 'UA103',
        airline: 'United Airlines',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T18:00:00Z',
        returnDate: null,
        price: '$100',
        status: 'ON_TIME',
    },
    {
        id: 4,
        flightNumber: 'CX104',
        airline: 'Cathay Pacific',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T10:00:00Z',
        returnDate: null,
        price: '$300',
        status: 'CANCELLED',
    }
];

const renderForm = () => render(
    <FlightBookingForm routes={routes} minimumDepartureDate="2026-07-14" />
);

describe('FlightBookingForm', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders origins and the destinations reachable from the default origin', () => {
        renderForm();
        expect(screen.getByText('Where Your Journey Takes Flight')).toBeInTheDocument();
        expect(screen.getByLabelText('Cabin class')).toHaveValue('economy');
        // Origins
        expect(screen.getByRole('option', { name: 'Seattle, USA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'New York, USA' })).toBeInTheDocument();
        // Destinations
        expect(screen.getByRole('option', { name: 'Detroit, USA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Tokyo, Japan' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'London, UK' })).not.toBeInTheDocument();
    });

    it('updates the destination options when the origin changes', () => {
        renderForm();
        fireEvent.change(screen.getByLabelText('From'), { target: { value: 'New York, USA' } });
        expect(screen.getByRole('option', { name: 'London, UK' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Detroit, USA' })).not.toBeInTheDocument();
    });

    it('defaults to the next operating date and updates it with the route', async () => {
        renderForm();

        expect(screen.getByLabelText('Depart')).toHaveValue('2026-07-15');
        expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-14');
        expect(screen.getByLabelText('Return')).toHaveValue('2026-07-22');
        expect(screen.getByLabelText('Return')).toHaveAttribute('min', '2026-07-15');

        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Tokyo, Japan' } });

        await waitFor(() => {
            expect(screen.getByLabelText('Depart')).toHaveValue('2026-07-16');
            expect(screen.getByLabelText('Return')).toHaveValue('2026-07-23');
        });
    });

    it('searches using the selected origin and destination', async () => {
        mockSearch.mockResolvedValue(mockFlights);

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
            expect(screen.getByText('CA101')).toBeInTheDocument();
        });
        expect(mockSearch).toHaveBeenCalledWith(
            'Seattle, USA',
            'Detroit, USA',
            expect.any(String),
            expect.any(String),
        );
    });

    it('rejects past departures and returns before departure before searching', async () => {
        renderForm();
        const form = screen.getByRole('button', { name: 'Find your trip' }).closest('form');
        expect(form).not.toBeNull();

        fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2026-07-13' } });
        fireEvent.submit(form!);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Departure date cannot be in the past.'
        );
        expect(mockSearch).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2026-07-15' } });
        fireEvent.change(screen.getByLabelText('Return'), { target: { value: '2026-07-14' } });
        fireEvent.submit(form!);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Return date cannot be before departure date.'
        );
        expect(mockSearch).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText('One Way'));
        await waitFor(() => {
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
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

    it('announces structured server search validation errors', async () => {
        mockSearch.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Departure date is invalid.',
                fields: { departureDate: ['Departure date is invalid.'] }
            }
        });

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Departure date is invalid.');
        expect(screen.queryByText('Available Flights')).not.toBeInTheDocument();
    });

    it('redirects to the book page when "Book Now" is clicked', async () => {
        mockSearch.mockResolvedValue(mockFlights);

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());

        const bookLink = screen.getByRole('link', { name: 'Book Now' });
        expect(bookLink).toBeInTheDocument();
        expect(bookLink).toHaveAttribute('href', '/book/1');
    });

    it('handles toggling trip type to one-way, input changes, and error handling', async () => {
        mockSearch.mockRejectedValue(new Error('Search failed'));
        mockBook.mockRejectedValue(new Error('Booking failed'));

        const { container } = renderForm();

        const classSelect = container.querySelector('#class') as HTMLSelectElement;
        fireEvent.change(classSelect, { target: { value: 'business' } });
        expect(classSelect.value).toBe('business');

        const departInput = container.querySelector('#depart') as HTMLInputElement;
        fireEvent.change(departInput, { target: { value: '2026-07-20' } });
        expect(departInput.value).toBe('2026-07-20');

        const oneWayRadio = screen.getByLabelText('One Way');
        fireEvent.click(oneWayRadio);
        
        const returnInput = container.querySelector('#returnDate') as HTMLInputElement;
        expect(returnInput).toBeDisabled();

        fireEvent.click(screen.getByText('Find your trip'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to search for flights right now.');
    });

    it('filters out cancelled flights and exposes interactive price, airline and sorting controls', async () => {
        mockSearch.mockResolvedValue(mockEnhancedFlights);

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        // Wait for search dashboard layout
        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
        });

        // 1. Exclude cancelled flights: CX104 should NOT exist
        expect(screen.queryByText('CX104')).not.toBeInTheDocument();
        expect(screen.getByText('GA101')).toBeInTheDocument();
        expect(screen.getByText('AA102')).toBeInTheDocument();
        expect(screen.getByText('UA103')).toBeInTheDocument();

        // 2. Airline Checkboxes filter: check "Gemini Airways"
        const geminiCheckbox = screen.getByLabelText('Gemini Airways');
        fireEvent.click(geminiCheckbox);

        // AA102 and UA103 should disappear, GA101 remains
        expect(screen.getByText('GA101')).toBeInTheDocument();
        expect(screen.queryByText('AA102')).not.toBeInTheDocument();
        expect(screen.queryByText('UA103')).not.toBeInTheDocument();

        // Uncheck "Gemini Airways" to restore results
        fireEvent.click(geminiCheckbox);
        expect(screen.getByText('AA102')).toBeInTheDocument();
        expect(screen.getByText('UA103')).toBeInTheDocument();

        // 3. Price slider filter: Max price is 500, min is 100. Slide to 300
        const priceSlider = screen.getByLabelText(/Max Price/i);
        fireEvent.change(priceSlider, { target: { value: '300' } });

        // UA103 ($100) and GA101 ($200) remain, AA102 ($500) disappears
        expect(screen.getByText('UA103')).toBeInTheDocument();
        expect(screen.getByText('GA101')).toBeInTheDocument();
        expect(screen.queryByText('AA102')).not.toBeInTheDocument();

        // 4. Reset Filters restores everything
        const resetBtn = screen.getByRole('button', { name: 'Reset' });
        fireEvent.click(resetBtn);
        expect(screen.getByText('AA102')).toBeInTheDocument();

        // 5. Sorting check
        const sortSelect = screen.getByLabelText('Sort:');
        
        // Price: Low to High (UA103 -> GA101 -> AA102)
        // Check by DOM position or ordering of airline/flight names
        fireEvent.change(sortSelect, { target: { value: 'price-asc' } });
        let flightNames = screen.getAllByText(/(GA101|AA102|UA103)/).map(el => el.textContent);
        expect(flightNames[0]).toBe('UA103');
        expect(flightNames[1]).toBe('GA101');
        expect(flightNames[2]).toBe('AA102');

        // Price: High to Low (AA102 -> GA101 -> UA103)
        fireEvent.change(sortSelect, { target: { value: 'price-desc' } });
        flightNames = screen.getAllByText(/(GA101|AA102|UA103)/).map(el => el.textContent);
        expect(flightNames[0]).toBe('AA102');
        expect(flightNames[1]).toBe('GA101');
        expect(flightNames[2]).toBe('UA103');

        // Departure: Latest (UA103 -> AA102 -> GA101)
        fireEvent.change(sortSelect, { target: { value: 'time-desc' } });
        flightNames = screen.getAllByText(/(GA101|AA102|UA103)/).map(el => el.textContent);
        expect(flightNames[0]).toBe('UA103');
        expect(flightNames[1]).toBe('AA102');
        expect(flightNames[2]).toBe('GA101');
    });
});
