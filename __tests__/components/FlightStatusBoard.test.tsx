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
        price: '$350',
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
        price: '$850',
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
        price: '$1200',
        status: 'CANCELLED',
    }
];

describe('FlightStatusBoard filtering and search', () => {
    it('renders the header and table with all flights initially', () => {
        render(<FlightStatusBoard flights={mockFlights} />);

        expect(screen.getByText('Live Flight Status')).toBeInTheDocument();
        expect(screen.getByText('GA101')).toBeInTheDocument();
        expect(screen.getByText('GA202')).toBeInTheDocument();
        expect(screen.getByText('GA303')).toBeInTheDocument();
    });

    it('filters flights by text search query', () => {
        render(<FlightStatusBoard flights={mockFlights} />);

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
        render(<FlightStatusBoard flights={mockFlights} />);

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
        render(<FlightStatusBoard flights={mockFlights} />);

        const searchInput = screen.getByPlaceholderText(/Search by flight number/i);
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        expect(screen.getByText('🔍 No flights found')).toBeInTheDocument();
    });
});
