import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightStatusDisplay, { FlightStatus } from '@/components/ui/flightStatus';

describe('FlightStatus component', () => {
    it('renders ON_TIME as On Time', () => {
        render(<FlightStatus status="ON_TIME" />);
        expect(screen.getByText('On Time')).toBeInTheDocument();
    });

    it('renders DELAYED as Delayed', () => {
        render(<FlightStatusDisplay status="DELAYED" />);
        expect(screen.getByText('Delayed')).toBeInTheDocument();
    });

    it('renders CANCELLED as Cancelled', () => {
        render(<FlightStatus status="CANCELLED" />);
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });
});
