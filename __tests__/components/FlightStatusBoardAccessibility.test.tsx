import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightStatusBoard from '@/components/ui/FlightStatusBoard';

const mockRenderedAt = Date.parse('2026-06-15T07:00:00.000Z');

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
        status: 'ON_TIME' as const,
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
        status: 'DELAYED' as const,
    },
];

describe('FlightStatusBoard Accessibility (#80)', () => {
    it('provides accessible label on flight status table', () => {
        render(
            <FlightStatusBoard
                flights={mockFlights}
                coverage="the next 7 days"
                renderedAt={mockRenderedAt}
            />
        );

        const table = screen.getByRole('table', { name: 'Flight departures and status' });
        expect(table).toBeInTheDocument();
        expect(table).toHaveAttribute('aria-label', 'Flight departures and status');
    });

    it('assigns scope="col" to all table column headers', () => {
        render(
            <FlightStatusBoard
                flights={mockFlights}
                coverage="the next 7 days"
                renderedAt={mockRenderedAt}
            />
        );

        const headers = screen.getAllByRole('columnheader');
        expect(headers).toHaveLength(6);

        const expectedHeaderNames = [
            'Flight',
            'From',
            'To',
            'Departure / Arrival',
            'Phase / Status',
            'Price',
        ];

        headers.forEach((header, index) => {
            expect(header).toHaveTextContent(expectedHeaderNames[index]);
            expect(header).toHaveAttribute('scope', 'col');
        });
    });

    it('provides accessible name and ID on flight search input', () => {
        render(
            <FlightStatusBoard
                flights={mockFlights}
                coverage="the next 7 days"
                renderedAt={mockRenderedAt}
            />
        );

        const searchInput = screen.getByRole('textbox', {
            name: 'Search flights by flight number, airline, origin, or destination',
        });
        expect(searchInput).toBeInTheDocument();
        expect(searchInput).toHaveAttribute('id', 'flight-status-search');
        expect(searchInput).toHaveAttribute(
            'aria-label',
            'Search flights by flight number, airline, origin, or destination'
        );
    });

    it('provides accessible name on flight phase / status filter dropdown', () => {
        render(
            <FlightStatusBoard
                flights={mockFlights}
                coverage="the next 7 days"
                renderedAt={mockRenderedAt}
            />
        );

        const statusSelect = screen.getByRole('combobox', {
            name: 'Filter by flight phase or status',
        });
        expect(statusSelect).toBeInTheDocument();
        expect(statusSelect).toHaveAttribute('aria-label', 'Filter by flight phase or status');
    });
});
