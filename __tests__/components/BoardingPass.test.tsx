import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import BoardingPass from '@/components/ui/BoardingPass';

const baseProps = {
    passengerName: 'Ada Lovelace',
    reference: 'MA-0123456789ABCDEF0123',
    airline: 'Gemini Airways',
    flightNumber: 'GA-100',
    from: 'Seattle, USA',
    to: 'Tokyo, Japan',
    departureReadable: 'Aug 19, 2026 at 08:00 PDT',
    seat: 'Seat 11A',
    cabin: 'Economy',
};

describe('BoardingPass', () => {
    it('renders the REWARD TICKET badge when isRewardBooking is true', () => {
        render(<BoardingPass {...baseProps} isRewardBooking={true} />);

        const badge = screen.getByTestId('boarding-pass-reward-badge');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent('REWARD TICKET');
        expect(badge).toHaveClass('checkin-reward-ticket-badge');
    });

    it('does not render the REWARD TICKET badge when isRewardBooking is false', () => {
        render(<BoardingPass {...baseProps} isRewardBooking={false} />);

        expect(screen.queryByTestId('boarding-pass-reward-badge')).not.toBeInTheDocument();
        expect(screen.queryByText('REWARD TICKET')).not.toBeInTheDocument();
    });

    it('does not render the REWARD TICKET badge when isRewardBooking is omitted', () => {
        render(<BoardingPass {...baseProps} />);

        expect(screen.queryByTestId('boarding-pass-reward-badge')).not.toBeInTheDocument();
        expect(screen.queryByText('REWARD TICKET')).not.toBeInTheDocument();
    });
});
