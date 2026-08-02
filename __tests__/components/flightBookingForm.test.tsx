import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightBookingForm from '@/components/ui/flightBookingForm';
import { bookFlightAction, searchFlightsAction } from '@/app/actions';
import type { FlightSearchCriteria } from '@/lib/flightSearchUrl';

// Mock server actions
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
    searchFlightsAction: jest.fn(),
}));

const mockSearch = searchFlightsAction as jest.Mock;
const mockBook = bookFlightAction as jest.Mock;

const searchSuccess = (flights: unknown[], nearbyDates: string[] = []) => ({
    flights,
    nearbyDates,
    inbound: null,
});

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

const renderForm = (initialSearch?: FlightSearchCriteria) => render(
    <FlightBookingForm
        routes={routes}
        minimumDepartureDate="2026-07-14"
        maximumDepartureDate="2027-07-14"
        initialSearch={initialSearch}
    />
);

describe('FlightBookingForm', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
        jest.clearAllMocks();
        window.history.replaceState(null, '', '/');
    });
    afterEach(() => jest.useRealTimers());

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
        expect(screen.getByLabelText('Depart')).toHaveAttribute('max', '2027-07-14');
        expect(screen.getByLabelText('Return')).toHaveValue('2026-07-22');
        expect(screen.getByLabelText('Return')).toHaveAttribute('min', '2026-07-15');
        expect(screen.getByLabelText('Return')).toHaveAttribute('max', '2027-07-14');

        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Tokyo, Japan' } });

        await waitFor(() => {
            expect(screen.getByLabelText('Depart')).toHaveValue('2026-07-16');
            expect(screen.getByLabelText('Return')).toHaveValue('2026-07-23');
        });
    });

    it("refreshes the booking window when the origin airport's day changes", () => {
        // Seattle is the default origin, so the window rolls over at 07:00 UTC
        // on PDT, not at UTC midnight.
        jest.useFakeTimers().setSystemTime(new Date('2026-07-15T06:59:59.000Z'));
        renderForm();

        expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-14');
        expect(screen.getByLabelText('Depart')).toHaveAttribute('max', '2027-07-14');

        act(() => jest.advanceTimersByTime(1_001));

        expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-15');
        expect(screen.getByLabelText('Depart')).toHaveAttribute('max', '2027-07-15');
        expect(screen.getByLabelText('Return')).toHaveAttribute('max', '2027-07-15');
    });

    it('does not roll the window over at UTC midnight for an origin behind UTC', () => {
        // The old UTC-anchored behaviour would have offered 2026-07-15 here,
        // while it is still the afternoon of the 14th in Seattle.
        jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:01.000Z'));

        renderForm();

        expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-14');
    });

    it('reconciles a stale server booking window during hydration', () => {
        jest.setSystemTime(new Date('2026-07-15T07:00:01.000Z'));

        renderForm();

        expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-15');
        expect(screen.getByLabelText('Depart')).toHaveAttribute('max', '2027-07-15');
        expect(screen.getByLabelText('Return')).toHaveAttribute('max', '2027-07-15');
    });

    it('moves the window to the newly selected origin airport', async () => {
        // 05:00 UTC is already the 15th in New York and still the 14th in
        // Seattle, so the earliest selectable date depends on the origin.
        jest.useFakeTimers().setSystemTime(new Date('2026-07-15T05:00:00.000Z'));
        renderForm();

        expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-14');

        fireEvent.change(screen.getByLabelText('From'), { target: { value: 'New York, USA' } });

        await waitFor(() => {
            expect(screen.getByLabelText('Depart')).toHaveAttribute('min', '2026-07-15');
        });
    });

    it('searches using the selected origin and destination', async () => {
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));

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

    it('writes searched criteria to a shareable URL', async () => {
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());
        const params = new URLSearchParams(window.location.search);
        expect(params.get('from')).toBe('Seattle, USA');
        expect(params.get('to')).toBe('Detroit, USA');
        expect(params.get('depart')).toBe('2026-07-15');
        expect(params.get('return')).toBe('2026-07-22');
        expect(params.get('trip')).toBe('round-trip');
    });

    it('restores shared criteria and automatically reruns the search', async () => {
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));
        const initialSearch: FlightSearchCriteria = {
            from: 'New York, USA',
            to: 'London, UK',
            departureDate: '2026-07-20',
            returnDate: '2026-07-27',
            tripType: 'round-trip',
        };

        renderForm(initialSearch);

        expect(screen.getByLabelText('From')).toHaveValue('New York, USA');
        expect(screen.getByLabelText('To')).toHaveValue('London, UK');
        expect(screen.getByLabelText('Depart')).toHaveValue('2026-07-20');
        expect(screen.getByLabelText('Return')).toHaveValue('2026-07-27');
        await waitFor(() => {
            expect(mockSearch).toHaveBeenCalledWith(
                'New York, USA',
                'London, UK',
                '2026-07-20',
                '2026-07-27',
            );
        });
        expect(await screen.findByText('Available Flights')).toBeInTheDocument();
        expect(screen.getByLabelText('Depart')).toHaveValue('2026-07-20');
    });

    it('restores and reruns a route-only search without optional dates', async () => {
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));
        const initialSearch: FlightSearchCriteria = {
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '',
            returnDate: '',
            tripType: 'round-trip',
        };

        renderForm(initialSearch);

        expect(screen.getByLabelText('Depart')).toHaveValue('');
        expect(screen.getByLabelText('Return')).toHaveValue('');
        await waitFor(() => {
            expect(mockSearch).toHaveBeenCalledWith(
                'Seattle, USA',
                'Detroit, USA',
                '',
                '',
            );
        });
        expect(await screen.findByText('Available Flights')).toBeInTheDocument();
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

        fireEvent.click(screen.getByLabelText('One Way'));
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Departure date cannot be in the past.'
        );
        fireEvent.click(screen.getByLabelText('Round Trip'));

        fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2026-07-15' } });
        fireEvent.change(screen.getByLabelText('Return'), { target: { value: '2026-07-14' } });
        fireEvent.submit(form!);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Return date cannot be before departure date.'
        );
        expect(mockSearch).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText('Round Trip'));
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Return date cannot be before departure date.'
        );

        fireEvent.click(screen.getByLabelText('One Way'));
        await waitFor(() => {
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    it('requires a departure date when a return date is provided before searching', async () => {
        renderForm();
        const form = screen.getByRole('button', { name: 'Find your trip' }).closest('form');
        expect(form).not.toBeNull();

        fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Return'), { target: { value: '2026-07-20' } });
        fireEvent.submit(form!);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Departure date is required when a return date is provided.'
        );
        expect(mockSearch).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText('One Way'));
        await waitFor(() => {
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    it('rejects departures and returns beyond the booking window before searching', async () => {
        renderForm();
        const form = screen.getByRole('button', { name: 'Find your trip' }).closest('form');
        expect(form).not.toBeNull();

        fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2027-07-15' } });
        fireEvent.submit(form!);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Departure date cannot be more than 365 days in advance.'
        );
        expect(mockSearch).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2027-07-14' } });
        expect(screen.getByLabelText('Return')).toHaveValue('2027-07-14');
        fireEvent.change(screen.getByLabelText('Return'), { target: { value: '2027-07-15' } });
        fireEvent.submit(form!);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Return date cannot be more than 365 days in advance.'
        );
        expect(mockSearch).not.toHaveBeenCalled();
    });

    it('searches a suggested nearby date when no flights match the exact date', async () => {
        mockSearch
            .mockResolvedValueOnce(searchSuccess([], ['2026-07-15', '2026-07-17']))
            .mockResolvedValueOnce(searchSuccess(mockFlights));

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText(/No flights found/i)).toBeInTheDocument();
        });
        expect(screen.queryByText('Available Flights')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Wed, Jul 15' }));

        await waitFor(() => {
            expect(screen.getByText('Available Flights')).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Available Flights' })).toHaveFocus();
        expect(mockSearch).toHaveBeenLastCalledWith(
            'Seattle, USA',
            'Detroit, USA',
            '2026-07-15',
            '2026-07-22',
        );
    });

    it('removes nearby suggestions when the route changes', async () => {
        mockSearch.mockResolvedValue(searchSuccess([], ['2026-07-15', '2026-07-17']));

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));
        expect(await screen.findByLabelText('Nearby operating dates')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('From'), { target: { value: 'New York, USA' } });

        expect(screen.queryByLabelText('Nearby operating dates')).not.toBeInTheDocument();
    });

    it('discards a stale search response after the criteria change', async () => {
        let resolveSearch: (result: ReturnType<typeof searchSuccess>) => void = () => undefined;
        mockSearch.mockReturnValue(new Promise((resolve) => {
            resolveSearch = resolve;
        }));

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));
        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Tokyo, Japan' } });

        await act(async () => {
            resolveSearch(searchSuccess([], ['2026-07-15', '2026-07-17']));
        });

        expect(screen.queryByLabelText('Nearby operating dates')).not.toBeInTheDocument();
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
        expect(screen.queryByRole('button', { name: 'Retry search' })).not.toBeInTheDocument();
        expect(screen.queryByText('Available Flights')).not.toBeInTheDocument();
    });

    it('announces search progress and prevents duplicate submissions while pending', async () => {
        let resolveSearch: (result: ReturnType<typeof searchSuccess>) => void = () => undefined;
        mockSearch.mockReturnValue(new Promise((resolve) => {
            resolveSearch = resolve;
        }));

        renderForm();
        const submitButton = screen.getByRole('button', { name: 'Find your trip' });
        fireEvent.click(submitButton);

        expect(await screen.findByRole('status')).toHaveTextContent('Searching for flights');
        expect(screen.getByRole('button', { name: 'Searching...' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Searching...' }));
        expect(mockSearch).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveSearch(searchSuccess(mockFlights));
        });

        await waitFor(() => {
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
        });
    });

    it('offers a retry after a service failure using the failed search criteria', async () => {
        mockSearch
            .mockRejectedValueOnce(new Error('Database unavailable'))
            .mockResolvedValueOnce(searchSuccess(mockFlights));

        renderForm();
        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Tokyo, Japan' } });
        await waitFor(() => {
            expect(screen.getByLabelText('Depart')).toHaveValue('2026-07-16');
            expect(screen.getByLabelText('Return')).toHaveValue('2026-07-23');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Find your trip' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Unable to search for flights right now.');
        const retryButton = screen.getByRole('button', { name: 'Retry search' });
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Available Flights' })).toBeInTheDocument();
        });
        expect(mockSearch).toHaveBeenCalledTimes(2);
        expect(mockSearch).toHaveBeenNthCalledWith(
            2,
            'Seattle, USA',
            'Tokyo, Japan',
            '2026-07-16',
            '2026-07-23',
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('preserves a displayed departure error when the server also reports a return error', async () => {
        mockSearch.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Departure date cannot be in the past.',
                fields: {
                    departureDate: ['Departure date cannot be in the past.'],
                    returnDate: ['Return date cannot be before departure date.'],
                },
            },
        });

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Departure date cannot be in the past.'
        );

        fireEvent.click(screen.getByLabelText('One Way'));
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Departure date cannot be in the past.'
        );
    });

    it('redirects to the book page when "Book Now" is clicked', async () => {
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));

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
        mockSearch.mockResolvedValue(searchSuccess(mockEnhancedFlights));

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

    it('lists return flights for a round trip', async () => {
        mockSearch.mockResolvedValue({
            flights: mockFlights,
            nearbyDates: [],
            inbound: {
                flights: [{
                    id: 99,
                    airline: 'Gemini Airways',
                    flightNumber: 'GA900',
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    departureDate: '2026-07-22T09:00:00Z',
                    returnDate: null,
                    price: '$275',
                    status: 'ON_TIME',
                }],
                nearbyDates: [],
            },
        });
        renderForm();

        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByTestId('inbound-results')).toBeInTheDocument();
        });
        expect(screen.getByText('GA900')).toBeInTheDocument();
        expect(screen.getByText('$275')).toBeInTheDocument();
    });

    it('shows no return section for a one-way search', async () => {
        mockSearch.mockResolvedValue({ flights: mockFlights, nearbyDates: [], inbound: null });
        renderForm();

        fireEvent.click(screen.getByLabelText('One Way'));
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText('CA101')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('inbound-results')).not.toBeInTheDocument();
    });

    it('says so when the return date has no flights', async () => {
        mockSearch.mockResolvedValue({
            flights: mockFlights,
            nearbyDates: [],
            inbound: { flights: [], nearbyDates: ['2026-07-23'] },
        });
        renderForm();

        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText('No return flights available on this date.')).toBeInTheDocument();
        });
    });
});
