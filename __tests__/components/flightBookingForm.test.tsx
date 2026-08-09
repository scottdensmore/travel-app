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

const inboundOk = (flights: unknown[], nearbyDates: string[] = []) =>
    ({ status: 'ok', flights, nearbyDates });

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
        priceCents: 35000,
        status: 'ON_TIME',
        cabinAvailable: true,
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
        priceCents: 20000,
        status: 'ON_TIME',
        cabinAvailable: true,
    },
    {
        id: 2,
        flightNumber: 'AA102',
        airline: 'American Airlines',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T12:00:00Z',
        returnDate: null,
        priceCents: 50000,
        status: 'ON_TIME',
        cabinAvailable: true,
    },
    {
        id: 3,
        flightNumber: 'UA103',
        airline: 'United Airlines',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T18:00:00Z',
        returnDate: null,
        priceCents: 10000,
        status: 'ON_TIME',
        cabinAvailable: true,
    },
    {
        id: 4,
        flightNumber: 'CX104',
        airline: 'Cathay Pacific',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-05-15T10:00:00Z',
        returnDate: null,
        priceCents: 30000,
        status: 'CANCELLED',
        cabinAvailable: true,
    }
];

const renderForm = (initialSearch?: FlightSearchCriteria, unusableLink = false) => render(
    <FlightBookingForm
        routes={routes}
        minimumDepartureDate="2026-07-14"
        maximumDepartureDate="2027-07-14"
        initialSearch={initialSearch}
        unusableLink={unusableLink}
    />
);

describe('a link the page could not honour', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
        jest.clearAllMocks();
        // A restored search runs on mount, so it needs an answer -- otherwise
        // it settles through the error branch outside `act` and the fixture
        // models a failed search rather than a link that worked.
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));
        window.history.replaceState(null, '', '/');
    });
    afterEach(() => jest.useRealTimers());

    it('says the link was not used, rather than looking like a first visit', () => {
        // Without this the address bar names one trip and the form shows
        // another, with nothing to tell them apart (#73).
        renderForm(undefined, true);

        expect(screen.getByRole('alert')).toHaveTextContent(/not one we can show/i);
    });

    it('says nothing when the traveller simply opened the page', () => {
        renderForm();

        expect(screen.queryByText(/not one we can show/i)).not.toBeInTheDocument();
    });

    it('stops saying it once the traveller runs a search of their own', async () => {
        // The search rewrites the URL through `replaceState`, which never
        // re-renders the server component -- so a notice read straight from
        // the prop would sit above results that contradict it (#73).
        renderForm(undefined, true);
        expect(screen.getByRole('alert')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Find your trip'));
        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());

        expect(screen.queryByText(/not one we can show/i)).not.toBeInTheDocument();
    });

    it('says nothing when the link worked', async () => {
        renderForm({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-07-15',
            returnDate: '',
            tripType: 'one-way',
            cabinClass: 'ECONOMY' as const,
        });

        // A restored search runs on mount; awaiting it keeps its state updates
        // inside `act` and makes this assert against the settled page.
        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());
        expect(screen.queryByText(/not one we can show/i)).not.toBeInTheDocument();
    });
});

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
        expect(screen.getByLabelText('Cabin class')).toHaveValue('ECONOMY');
        // Origins
        expect(screen.getByRole('option', { name: 'Seattle, USA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'New York, USA' })).toBeInTheDocument();
        // Destinations
        expect(screen.getByRole('option', { name: 'Detroit, USA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Tokyo, Japan' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'London, UK' })).not.toBeInTheDocument();
    });

    it('offers no control that does nothing', () => {
        // A reward checkbox with no redemption behind it, and a Multicity link
        // pointing at "#", both promised a search the app cannot run (#70).
        const { container } = renderForm();

        expect(screen.queryByLabelText(/reward flights/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /multicity/i })).not.toBeInTheDocument();
        expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
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
            'ECONOMY',
        );
    });

    it('writes searched criteria to a shareable URL', async () => {
        mockSearch.mockResolvedValue(searchSuccess(mockFlights));

        renderForm();
        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => expect(screen.getByText('Available Flights')).toBeInTheDocument());
        const params = new URLSearchParams(window.location.search);
        // The link names airports by code; the form goes on showing words (#73).
        expect(params.get('from')).toBe('SEA');
        expect(params.get('to')).toBe('DTW');
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
            cabinClass: 'ECONOMY' as const,
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
                'ECONOMY',
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
            cabinClass: 'ECONOMY' as const,
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
                'ECONOMY',
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
            'ECONOMY',
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
            'ECONOMY',
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
        expect(bookLink).toHaveAttribute('href', '/checkout?outbound=1');
    });

    it('handles toggling trip type to one-way, input changes, and error handling', async () => {
        mockSearch.mockRejectedValue(new Error('Search failed'));
        mockBook.mockRejectedValue(new Error('Booking failed'));

        const { container } = renderForm();

        const classSelect = container.querySelector('#class') as HTMLSelectElement;
        fireEvent.change(classSelect, { target: { value: 'BUSINESS' } });
        expect(classSelect.value).toBe('BUSINESS');

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

        // 3. Price slider filter, in minor units: max $500, min $100. Slide to
        // $300. The control works in the same units the server stores, so no
        // step of this depends on how a price was formatted for display.
        const priceSlider = screen.getByLabelText(/Max Price/i);
        expect(priceSlider).toHaveAttribute('min', '10000');
        expect(priceSlider).toHaveAttribute('max', '50000');
        fireEvent.change(priceSlider, { target: { value: '30000' } });

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
                status: 'ok',
                flights: [{
                    id: 99,
                    airline: 'Gemini Airways',
                    flightNumber: 'GA900',
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    departureDate: '2026-07-22T09:00:00Z',
                    returnDate: null,
                    priceCents: 27500,
                    status: 'ON_TIME',
                    cabinAvailable: true,
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

    describe('Shopping a cabin', () => {
        const businessFlights = [
            { ...mockFlights[0], id: 1, flightNumber: 'CA101', priceCents: 70000, cabinAvailable: true },
            { ...mockFlights[0], id: 2, flightNumber: 'CA202', priceCents: 35000, cabinAvailable: false },
        ];

        it('sends the chosen cabin to the search', async () => {
            mockSearch.mockResolvedValue(searchSuccess(businessFlights));
            renderForm();

            fireEvent.change(screen.getByLabelText('Cabin class'), { target: { value: 'BUSINESS' } });
            fireEvent.click(screen.getByText('Find your trip'));

            await waitFor(() => expect(mockSearch).toHaveBeenCalledWith(
                'Seattle, USA', 'Detroit, USA', expect.any(String), expect.any(String), 'BUSINESS',
            ));
        });

        it('marks the flights that do not operate that cabin', async () => {
            mockSearch.mockResolvedValue(searchSuccess(businessFlights));
            renderForm();

            fireEvent.change(screen.getByLabelText('Cabin class'), { target: { value: 'BUSINESS' } });
            fireEvent.click(screen.getByText('Find your trip'));

            await waitFor(() => expect(screen.getByText('CA101')).toBeInTheDocument());
            // Both are offered; only one is marked. Hiding the second would
            // report no flights on a route that has seats.
            expect(screen.getByText('CA202')).toBeInTheDocument();
            const notes = screen.getAllByTestId('cabin-unavailable');
            expect(notes).toHaveLength(1);
            expect(notes[0]).toHaveTextContent('No Business cabin');
            expect(notes[0]).toHaveTextContent('Economy fare shown');
        });

        it('clears results the moment the cabin changes, so no stale fare can be booked', async () => {
            // Seeded with real results: an empty list is the one case the old
            // clearing helper handled, so testing with it proved nothing.
            mockSearch.mockResolvedValue(searchSuccess(businessFlights));
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));
            await waitFor(() => expect(screen.getByText('CA101')).toBeInTheDocument());
            expect(screen.getAllByRole('link', { name: 'Book Now' })).not.toHaveLength(0);

            fireEvent.change(screen.getByLabelText('Cabin class'), { target: { value: 'FIRST' } });

            // The checkout link switches cabin immediately, so leaving the cards
            // up would offer a First booking at the fare shown for economy.
            expect(screen.queryByText('CA101')).not.toBeInTheDocument();
            expect(screen.queryByText('Available Flights')).not.toBeInTheDocument();
            expect(screen.queryAllByRole('link', { name: 'Book Now' })).toHaveLength(0);
        });

        it('restores a shared cabin from the URL', async () => {
            mockSearch.mockResolvedValue(searchSuccess(businessFlights));
            renderForm({
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-15',
                returnDate: '2026-07-22',
                tripType: 'round-trip',
                cabinClass: 'BUSINESS' as const,
            });

            expect(screen.getByLabelText('Cabin class')).toHaveValue('BUSINESS');
            await waitFor(() => expect(mockSearch).toHaveBeenCalledWith(
                'Seattle, USA', 'Detroit, USA', '2026-07-15', '2026-07-22', 'BUSINESS',
            ));
        });
    });

    describe('Sorting and filtering on server values', () => {
        it('orders by the stored fare, not by the formatted label', async () => {
            // The labels sort the wrong way as text: "$1,200" precedes "$900"
            // alphabetically, and stripping non-digits from "$1,200" once gave
            // 1200 while "$900" gave 900 -- the old parser's exact failure.
            mockSearch.mockResolvedValue(searchSuccess([
                { ...mockFlights[0], id: 1, flightNumber: 'EXPENSIVE', priceCents: 120_000 },
                { ...mockFlights[0], id: 2, flightNumber: 'CHEAP', priceCents: 90_000 },
            ]));
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));
            await waitFor(() => expect(screen.getByText('CHEAP')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('Sort:'), { target: { value: 'price-asc' } });
            let order = screen.getAllByText(/(CHEAP|EXPENSIVE)/).map(el => el.textContent);
            expect(order).toEqual(['CHEAP', 'EXPENSIVE']);

            fireEvent.change(screen.getByLabelText('Sort:'), { target: { value: 'price-desc' } });
            order = screen.getAllByText(/(CHEAP|EXPENSIVE)/).map(el => el.textContent);
            expect(order).toEqual(['EXPENSIVE', 'CHEAP']);
        });

        it('renders the stored fare, not the formatted string beside it', async () => {
            // If the two ever disagree, the number the database can compare and
            // sum is the one a customer should be quoted (#135).
            mockSearch.mockResolvedValue(searchSuccess([
                { ...mockFlights[0], id: 1, priceCents: 35_000 },
            ]));
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));

            await waitFor(() => expect(screen.getByText('CA101')).toBeInTheDocument());
            expect(screen.getByText('$350')).toBeInTheDocument();
            expect(screen.queryByText('$999')).not.toBeInTheDocument();
        });


        it('labels the price filter with the same formatter the results use', async () => {
            mockSearch.mockResolvedValue(searchSuccess([
                { ...mockFlights[0], id: 1, priceCents: 90_000 },
                { ...mockFlights[0], id: 2, flightNumber: 'CA999', priceCents: 120_000 },
            ]));
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));
            await waitFor(() => expect(screen.getByText('CA999')).toBeInTheDocument());

            expect(screen.getByLabelText(/Max Price/i)).toHaveValue('120000');
            expect(screen.getByText(/Max Price: \$1,200/)).toBeInTheDocument();
        });

    });

    it('shows no return date on an outbound card', async () => {
        // Flight.returnDate was a fixed seven days after departure and never
        // described a real return; the return is its own flight now (#112).
        mockSearch.mockResolvedValue(searchSuccess([
            { ...mockFlights[0], returnDate: '2026-05-22T12:00:00Z' },
        ]));
        renderForm();

        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => expect(screen.getByText('CA101')).toBeInTheDocument());
        const card = screen.getByText('CA101').closest('.flight-result-card')!;
        expect(card).toHaveTextContent('Seattle, USA');
        expect(card).toHaveTextContent('Detroit, USA');
        expect(card).not.toHaveTextContent('One Way');
        expect(card).not.toHaveTextContent(new Date('2026-05-22T12:00:00Z').toLocaleDateString());
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

    describe('Choosing both legs of a round trip', () => {
        const roundTripResults = {
            flights: mockFlights,
            nearbyDates: [],
            inbound: {
                status: 'ok',
                flights: [
                    {
                        id: 99,
                        airline: 'Gemini Airways',
                        flightNumber: 'GA900',
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        departureDate: '2026-07-22T09:00:00Z',
                        returnDate: null,
                        priceCents: 27500,
                        status: 'ON_TIME',
                        cabinAvailable: true,
                    },
                    {
                        id: 100,
                        airline: 'United Airlines',
                        flightNumber: 'UA901',
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        departureDate: '2026-07-22T17:00:00Z',
                        returnDate: null,
                        priceCents: 31000,
                        status: 'ON_TIME',
                        cabinAvailable: true,
                    },
                ],
                nearbyDates: [],
            },
        };

        const search = async (results: unknown = roundTripResults) => {
            mockSearch.mockResolvedValue(results);
            renderForm();
            fireEvent.click(screen.getByText('Find your trip'));
            await waitFor(() => expect(screen.getByTestId('inbound-results')).toBeInTheDocument());
        };

        it('replaces the per-flight book link with a selection for a round trip', async () => {
            await search();

            // A round trip cannot be booked one card at a time.
            expect(screen.queryAllByRole('link', { name: 'Book Now' })).toHaveLength(0);
            expect(screen.getAllByRole('button', { name: /Select flight/ }).length).toBeGreaterThan(1);
        });

        it('books nothing until both legs are chosen', async () => {
            await search();

            const cta = screen.getByTestId('round-trip-book');
            expect(cta).toHaveAttribute('aria-disabled', 'true');
            expect(cta).not.toHaveAttribute('href');
            expect(screen.getByTestId('round-trip-summary')).toHaveTextContent(/choose a departing flight/i);

            fireEvent.click(screen.getByRole('button', { name: /Select flight CA101/ }));
            expect(screen.getByTestId('round-trip-book')).toHaveAttribute('aria-disabled', 'true');
            expect(screen.getByTestId('round-trip-summary')).toHaveTextContent(/choose a return flight/i);

            fireEvent.click(screen.getByRole('button', { name: /Select flight GA900/ }));

            const ready = screen.getByTestId('round-trip-book');
            expect(ready).not.toHaveAttribute('aria-disabled');
            expect(ready).toHaveAttribute('href', '/checkout?outbound=1&inbound=99');
        });

        it('marks the chosen flight on each leg and lets it be changed', async () => {
            await search();

            fireEvent.click(screen.getByRole('button', { name: /Select flight CA101/ }));
            fireEvent.click(screen.getByRole('button', { name: /Select flight GA900/ }));
            expect(screen.getByRole('button', { name: /Select flight GA900/ })).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByRole('button', { name: /Select flight UA901/ })).toHaveAttribute('aria-pressed', 'false');

            // Switching the return leg replaces it rather than adding a second.
            fireEvent.click(screen.getByRole('button', { name: /Select flight UA901/ }));
            expect(screen.getByRole('button', { name: /Select flight GA900/ })).toHaveAttribute('aria-pressed', 'false');
            expect(screen.getByTestId('round-trip-book')).toHaveAttribute('href', '/checkout?outbound=1&inbound=100');
        });

        it('totals the two selected fares', async () => {
            await search();

            fireEvent.click(screen.getByRole('button', { name: /Select flight CA101/ }));
            fireEvent.click(screen.getByRole('button', { name: /Select flight UA901/ }));

            // $350 outbound + $310 return.
            expect(screen.getByTestId('round-trip-summary')).toHaveTextContent('$660');
        });

        it('drops a selection that a new search no longer offers', async () => {
            await search();
            fireEvent.click(screen.getByRole('button', { name: /Select flight CA101/ }));
            fireEvent.click(screen.getByRole('button', { name: /Select flight GA900/ }));
            expect(screen.getByTestId('round-trip-book')).toHaveAttribute('href', '/checkout?outbound=1&inbound=99');

            // A second search returns a different return leg; the stale id must
            // not survive into the checkout link.
            mockSearch.mockResolvedValue({
                ...roundTripResults,
                inbound: { status: 'ok', flights: [roundTripResults.inbound.flights[1]], nearbyDates: [] },
            });
            fireEvent.click(screen.getByText('Find your trip'));

            // Wait for the second set of results, not merely for the first to go.
            await waitFor(() =>
                expect(screen.getByRole('button', { name: /Select flight UA901/ })).toBeInTheDocument()
            );
            expect(screen.queryByRole('button', { name: /Select flight GA900/ })).not.toBeInTheDocument();
            expect(screen.getByTestId('round-trip-book')).toHaveAttribute('aria-disabled', 'true');
        });

        it('stops offering an outbound that the filters have hidden', async () => {
            await search({
                ...roundTripResults,
                flights: mockEnhancedFlights,
            });

            // GA101 is $200, UA103 is $100.
            fireEvent.click(screen.getByRole('button', { name: /Select flight GA101/ }));
            fireEvent.click(screen.getByRole('button', { name: /Select flight GA900/ }));
            expect(screen.getByTestId('round-trip-book')).toHaveAttribute('href', '/checkout?outbound=1&inbound=99');

            // Filter the chosen flight out of the results by price.
            fireEvent.change(screen.getByLabelText(/Max Price/i), { target: { value: '150' } });

            expect(screen.queryByRole('button', { name: /Select flight GA101/ })).not.toBeInTheDocument();
            expect(screen.getByTestId('round-trip-book')).toHaveAttribute('aria-disabled', 'true');
            expect(screen.getByTestId('round-trip-summary')).toHaveTextContent(/choose a departing flight/i);
        });

        it('still books one leg at a time when the return date has no flights', async () => {
            await search({ ...roundTripResults, inbound: { status: 'ok', flights: [], nearbyDates: [] } });

            // Requiring a return that does not exist would be a dead end.
            expect(screen.getByText('No return flights available on this date.')).toBeInTheDocument();
            expect(screen.queryByTestId('round-trip-book')).not.toBeInTheDocument();
            expect(screen.getAllByRole('link', { name: 'Book Now' })[0]).toHaveAttribute('href', '/checkout?outbound=1');
        });
    });

    describe('When only the return leg fails', () => {
        const degraded = {
            flights: mockFlights,
            nearbyDates: [],
            inbound: { status: 'unavailable' },
        };

        it('keeps the outbound results and says the return could not be loaded', async () => {
            mockSearch.mockResolvedValue(degraded);
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));

            await waitFor(() => expect(screen.getByTestId('inbound-unavailable')).toBeInTheDocument());
            // The outbound half of the trip is still usable.
            expect(screen.getByText('CA101')).toBeInTheDocument();
            expect(screen.getByTestId('inbound-unavailable')).toHaveTextContent(/could not load return flights/i);
            // Not the same message as a return date that genuinely has none.
            expect(screen.queryByText('No return flights available on this date.')).not.toBeInTheDocument();
            expect(screen.queryByTestId('inbound-results')).not.toBeInTheDocument();
        });

        it('offers the outbound one leg at a time, since no return can be chosen', async () => {
            mockSearch.mockResolvedValue(degraded);
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));

            await waitFor(() => expect(screen.getByTestId('inbound-unavailable')).toBeInTheDocument());
            expect(screen.queryByTestId('round-trip-book')).not.toBeInTheDocument();
            expect(screen.getByRole('link', { name: 'Book Now' })).toHaveAttribute('href', '/checkout?outbound=1');
        });

        it('clears the warning when a retry succeeds', async () => {
            mockSearch.mockResolvedValueOnce(degraded);
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));
            await waitFor(() => expect(screen.getByTestId('inbound-unavailable')).toBeInTheDocument());

            mockSearch.mockResolvedValueOnce({
                flights: mockFlights,
                nearbyDates: [],
                inbound: inboundOk([{
                    id: 99,
                    flightNumber: 'GA900',
                    airline: 'Gemini Airways',
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    departureDate: '2026-07-22T09:00:00Z',
                    returnDate: null,
                    priceCents: 27500,
                    status: 'ON_TIME',
                    cabinAvailable: true,
                }]),
            });
            fireEvent.click(screen.getByRole('button', { name: 'Retry return flights' }));

            await waitFor(() => expect(screen.getByTestId('inbound-results')).toBeInTheDocument());
            expect(screen.queryByTestId('inbound-unavailable')).not.toBeInTheDocument();
            expect(screen.getByText('GA900')).toBeInTheDocument();
        });

        it('announces the warning to assistive technology', async () => {
            mockSearch.mockResolvedValue(degraded);
            renderForm();

            fireEvent.click(screen.getByText('Find your trip'));

            await waitFor(() => expect(screen.getByTestId('inbound-unavailable')).toBeInTheDocument());
            expect(screen.getByTestId('inbound-unavailable')).toHaveAttribute('role', 'status');
        });
    });

    it('says so when the return date has no flights', async () => {
        mockSearch.mockResolvedValue({
            flights: mockFlights,
            nearbyDates: [],
            inbound: { status: 'ok', flights: [], nearbyDates: ['2026-07-23'] },
        });
        renderForm();

        fireEvent.click(screen.getByText('Find your trip'));

        await waitFor(() => {
            expect(screen.getByText('No return flights available on this date.')).toBeInTheDocument();
        });
    });
    it('names cabins the way the rest of the booking does', () => {
        // The picker was hardcoded and said "First" while checkout, the review
        // and the boarding pass all said "First Class", so a customer chose one
        // cabin by name and was sold another (#169).
        render(<FlightBookingForm routes={routes} />);

        const options = Array.from(
            (screen.getByLabelText(/Cabin class/i) as HTMLSelectElement).options
        ).map(option => option.text);

        expect(options).toEqual(['Economy', 'Premium Economy', 'Business', 'First Class']);
        expect(options.some(text => /_/.test(text))).toBe(false);
    });

});