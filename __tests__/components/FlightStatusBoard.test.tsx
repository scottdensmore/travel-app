import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightStatusBoard from '@/components/ui/FlightStatusBoard';

const mockFlights = [
    {
        id: 1,
        flightNumber: 'GA101',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-06-15T08:00:00Z',
        returnDate: null,
        priceCents: 35000,
        status: 'ON_TIME',
    },
    {
        id: 2,
        flightNumber: 'GA202',
        airline: 'Gemini Airways',
        from: 'New York, USA',
        to: 'London, UK',
        departureDate: '2026-06-10T19:30:00Z',
        returnDate: null,
        priceCents: 85000,
        status: 'DELAYED',
    },
    {
        id: 3,
        flightNumber: 'GA303',
        airline: 'Other Air',
        from: 'San Francisco, USA',
        to: 'Tokyo, Japan',
        departureDate: '2026-07-05T11:00:00Z',
        returnDate: null,
        priceCents: 120000,
        status: 'CANCELLED',
    }
];

const coverage = 'the last 6 hours and the next 7 days';

/**
 * A departure belongs to the airport it leaves from.
 *
 * Every screen rendered it with `toLocaleDateString()`, which uses whichever
 * timezone the viewer's browser is set to -- so the same flight read
 * differently depending on where the person looking at it was sitting, and for
 * a departure near midnight it read as the wrong day. #84's acceptance criteria
 * rule that out: flight times use the relevant airport's timezone.
 */
describe('a departure is shown at the airport it leaves from', () => {
    it('reads the origin\'s date and clock, not the viewer\'s', () => {
        // 23:00Z is the 16th in Tokyo and the 15th in UTC, and the flight
        // leaves on the 16th.
        render(<FlightStatusBoard flights={[{
            ...mockFlights[0],
            id: 9001,
            from: 'Tokyo, Japan',
            to: 'Seattle, USA',
            departureDate: '2026-08-15T23:00:00Z',
        }] as never} coverage="the next 7 days" />);

        expect(screen.getByText('Aug 16, 2026')).toBeInTheDocument();
        expect(screen.getByText(/08:00/)).toBeInTheDocument();
    });

    it('names the timezone, so the time is not just a number', () => {
        render(<FlightStatusBoard flights={[{
            ...mockFlights[0],
            id: 9002,
            from: 'Tokyo, Japan',
            to: 'Seattle, USA',
            departureDate: '2026-08-15T23:00:00Z',
        }] as never} coverage="the next 7 days" />);

        expect(screen.getByText(/GMT\+9/)).toBeInTheDocument();
    });
});

describe('FlightStatusBoard coverage window', () => {
    // The board holds a window rather than the timetable (#153). A search for
    // something outside it returns nothing, which reads as "your flight is
    // missing" unless the board says what it covers.
    it('states the window it was given', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        expect(
            screen.getByText('This board covers departures in the last 6 hours and the next 7 days.')
        ).toBeInTheDocument();
    });

    it('answers a fruitless search by naming it and the range, and offers a way out', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        fireEvent.change(screen.getByPlaceholderText(/Search by flight number/i), {
            target: { value: 'GA999' },
        });

        expect(
            screen.getByText(
                'No flights on this board match “GA999”. It only covers departures in the last 6 hours and the next 7 days.'
            )
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Search all flights' })).toHaveAttribute('href', '/');
    });

    it('blames the filter and the search together when both are set', () => {
        // Checking the query first answered a search for something that *is* on
        // the board with "no flights match" — while the status filter was what
        // had removed it, and the offered way out was to go search again.
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        fireEvent.change(screen.getByPlaceholderText(/Search by flight number/i), {
            target: { value: 'GA101' },
        });
        fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'CANCELLED' } });

        expect(
            screen.getByText('No flights on this board match “GA101” and are marked Cancelled.')
        ).toBeInTheDocument();
        // GA101 is on the board, so the window is not the reason and must not
        // be offered as one.
        expect(screen.queryByText(/only covers departures/)).not.toBeInTheDocument();
    });

    it('raises the window when the search matches nothing, filter or no filter', () => {
        // The mirror of the case above: here the query is why the table is
        // empty, so the range is the useful thing to say.
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        fireEvent.change(screen.getByPlaceholderText(/Search by flight number/i), {
            target: { value: 'ZZ999' },
        });
        fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'DELAYED' } });

        expect(
            screen.getByText(
                'No flights on this board match “ZZ999”. It only covers departures in the last 6 hours and the next 7 days.'
            )
        ).toBeInTheDocument();
    });

    it('answers a status filter on its own terms, not as a failed search', () => {
        // Both DELAYED and CANCELLED rows can fall outside the window, so these
        // are reachable filters that used to tell the user to change a search
        // term they had never typed.
        render(<FlightStatusBoard flights={[mockFlights[0]]} coverage={coverage} />);

        fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'DELAYED' } });

        expect(screen.getByText('No flights on this board are marked Delayed.')).toBeInTheDocument();
        expect(screen.queryByText(/Try searching for a different destination/)).not.toBeInTheDocument();
        expect(screen.queryByText(/match “/)).not.toBeInTheDocument();
    });

    it('says the window is empty when nothing has been searched or filtered', () => {
        render(<FlightStatusBoard flights={[]} coverage={coverage} />);

        expect(
            screen.getByText('No departures are scheduled in the last 6 hours and the next 7 days.')
        ).toBeInTheDocument();
        // Nothing was typed, so there is no search to suggest changing.
        expect(screen.queryByText(/Try searching/)).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Search all flights' })).not.toBeInTheDocument();
    });

    it('claims neither a live feed nor arrivals, having neither', () => {
        // The subtitle said "Real-time departures, arrivals, and schedule
        // status updates". There is no feed, there is no arrivals column, and
        // the coverage line directly beneath refuted both a line later (#84).
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        expect(screen.queryByText(/Real-time/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/arrivals/i)).not.toBeInTheDocument();
    });

    it('announces how many flights are shown as the filters change', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        expect(screen.getByRole('status')).toHaveTextContent('3 flights shown');

        fireEvent.change(screen.getByPlaceholderText(/Search by flight number/i), {
            target: { value: 'GA101' },
        });
        expect(screen.getByRole('status')).toHaveTextContent('1 flight shown');

        fireEvent.change(screen.getByPlaceholderText(/Search by flight number/i), {
            target: { value: 'GA999' },
        });
        expect(screen.getByRole('status')).toHaveTextContent('0 flights shown');
    });
});

describe('FlightStatusBoard filtering and search', () => {
    it('renders the header and table with all flights initially', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        expect(screen.getByText('Live Flight Status')).toBeInTheDocument();
        expect(screen.getByText('GA101')).toBeInTheDocument();
        expect(screen.getByText('GA202')).toBeInTheDocument();
        expect(screen.getByText('GA303')).toBeInTheDocument();
    });

    it('filters flights by text search query', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        const searchInput = screen.getByPlaceholderText(/Search by flight number/i);
        
        // Search by airline
        fireEvent.change(searchInput, { target: { value: 'Other' } });
        expect(screen.getByText('GA303')).toBeInTheDocument();
        expect(screen.queryByText('GA101')).not.toBeInTheDocument();

        // Search by city
        fireEvent.change(searchInput, { target: { value: 'London' } });
        expect(screen.getByText('GA202')).toBeInTheDocument();
        expect(screen.queryByText('GA303')).not.toBeInTheDocument();
    });

    it('filters flights by status select dropdown', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        const statusSelect = screen.getByRole('combobox');
        
        // Filter by Delayed
        fireEvent.change(statusSelect, { target: { value: 'DELAYED' } });
        expect(screen.getByText('GA202')).toBeInTheDocument();
        expect(screen.queryByText('GA101')).not.toBeInTheDocument();
        expect(screen.queryByText('GA303')).not.toBeInTheDocument();

        // Filter by Cancelled
        fireEvent.change(statusSelect, { target: { value: 'CANCELLED' } });
        expect(screen.getByText('GA303')).toBeInTheDocument();
        expect(screen.queryByText('GA202')).not.toBeInTheDocument();
    });

    it('shows no flights found when query has no matches', () => {
        render(<FlightStatusBoard flights={mockFlights} coverage={coverage} />);

        const searchInput = screen.getByPlaceholderText(/Search by flight number/i);
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        // A heading, and named without the decorative emoji, so that is how it
        // is asked for.
        expect(screen.getByRole('heading', { name: 'No flights found' })).toBeInTheDocument();
    });
});
