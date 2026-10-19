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

    it('renders the Redemption detail when isRewardBooking is true and pointsRedeemed is greater than 0', () => {
        render(<BoardingPass {...baseProps} isRewardBooking={true} pointsRedeemed={15000} />);

        const redemption = screen.getByTestId('boarding-pass-redemption');
        expect(redemption).toBeInTheDocument();
        expect(redemption).toHaveTextContent('Redemption');
        expect(redemption).toHaveTextContent('15,000 pts');
    });

    it('does not render the Redemption detail when isRewardBooking is false or pointsRedeemed is omitted or 0', () => {
        const { unmount } = render(<BoardingPass {...baseProps} isRewardBooking={false} pointsRedeemed={15000} />);
        expect(screen.queryByTestId('boarding-pass-redemption')).not.toBeInTheDocument();
        unmount();

        const { unmount: unmountOmitted } = render(<BoardingPass {...baseProps} isRewardBooking={true} />);
        expect(screen.queryByTestId('boarding-pass-redemption')).not.toBeInTheDocument();
        unmountOmitted();

        const { unmount: unmountZero } = render(<BoardingPass {...baseProps} isRewardBooking={true} pointsRedeemed={0} />);
        expect(screen.queryByTestId('boarding-pass-redemption')).not.toBeInTheDocument();
        unmountZero();

        render(<BoardingPass {...baseProps} isRewardBooking={true} pointsRedeemed={null} />);
        expect(screen.queryByTestId('boarding-pass-redemption')).not.toBeInTheDocument();
    });
});

