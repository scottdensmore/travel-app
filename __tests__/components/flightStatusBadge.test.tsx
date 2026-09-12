import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightStatusBadge from '@/components/ui/flightStatusBadge';

describe('FlightStatusBadge component', () => {
    it('renders ON_TIME with badge style and label', () => {
        render(<FlightStatusBadge status="ON_TIME" />);
        const badge = screen.getByText('On Time');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveStyle({ color: '#34d399' });
    });

    it('renders DELAYED with badge style and label', () => {
        render(<FlightStatusBadge status="DELAYED" />);
        const badge = screen.getByText('Delayed');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveStyle({ color: '#fbbf24' });
    });

    it('renders CANCELLED with badge style and label', () => {
        render(<FlightStatusBadge status="CANCELLED" />);
        const badge = screen.getByText('Cancelled');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveStyle({ color: '#f87171' });
    });
});
