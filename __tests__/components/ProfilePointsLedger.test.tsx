import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

/** jsdom has no ResizeObserver; keep the callbacks so a test can fire them. */
const resizeObserverCallbacks: Array<() => void> = [];
beforeEach(() => { resizeObserverCallbacks.length = 0; });
global.ResizeObserver = class {
    constructor(callback: () => void) { resizeObserverCallbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

import ProfileClient from '@/components/ui/ProfileClient';
import PointsLedgerTable from '@/components/ui/PointsLedgerTable';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
    useRouter: jest.fn().mockReturnValue({
        refresh: jest.fn(),
    }),
}));

jest.mock('@/app/actions', () => ({
    cancelBookingAction: jest.fn(),
    deleteReviewAction: jest.fn(),
    updateCityGuideReviewAction: jest.fn(),
    toggleFavoriteCityGuideAction: jest.fn(),
    changeBookingSeatsAction: jest.fn(),
    getOccupiedSeatsAction: jest.fn(),
    retryBookingRefundAction: jest.fn(),
    rebookItineraryAction: jest.fn(),
}));

jest.mock('@/components/ui/charts/nextStatusChart', () => () => <div data-testid="status-chart" />);
jest.mock('@/components/ui/charts/pointsHistoryChart', () => () => <div data-testid="history-chart" />);

const sampleLedgerEntries = [
    {
        id: 'ple-1',
        type: 'WELCOME_GRANT',
        amount: 10000,
        balanceAfter: 10000,
        description: 'Welcome grant',
        createdAt: '2026-06-01T10:00:00Z',
    },
    {
        id: 'ple-2',
        type: 'FLIGHT_EARN',
        amount: 1750,
        balanceAfter: 11750,
        description: 'Points earned for flight booking #MA-1111',
        createdAt: '2026-06-02T15:30:00Z',
    },
    {
        id: 'ple-3',
        type: 'REWARD_REDEMPTION',
        amount: -15000,
        balanceAfter: 46750,
        description: 'Redemption for booking #MA-2222',
        createdAt: '2026-06-10T12:00:00Z',
    },
    {
        id: 'ple-4',
        type: 'REWARD_REFUND',
        amount: 12000,
        balanceAfter: 58750,
        description: 'Cancellation refund for booking #102',
        createdAt: '2026-06-11T09:00:00Z',
    },
];

describe('ProfilePointsLedger Component Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders spendable points balance card alongside tier status', () => {
        render(
            <ProfileClient
                userName="Alex Traveler"
                userAvatar="avatar.png"
                accountTimeZone="UTC"
                accountTimeZoneChoices={['UTC', 'America/Los_Angeles']}
                currentStatus="Gold"
                currentPoints={4200}
                spendablePointsBalance={58750}
                pointsLedgerEntries={sampleLedgerEntries}
                bookings={[]}
                favorites={[]}
                reviews={[]}
                activityData={[]}
                monthlyHistory={[]}
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
            />
        );

        // Tier status and status points
        expect(screen.getByText('Gold')).toBeInTheDocument();
        expect(screen.getByText('4,200')).toBeInTheDocument();

        // Spendable Points card
        const card = screen.getByTestId('spendable-points-card');
        expect(card).toBeInTheDocument();
        expect(within(card).getByTestId('spendable-points-balance')).toHaveTextContent('58,750 pts');
        expect(within(card).getByText(/Spendable Points/i)).toBeInTheDocument();
        expect(within(card).getByText(/Redeemable for award flights/i)).toBeInTheDocument();

        // Also in summary list
        expect(screen.getByText('58,750')).toBeInTheDocument();
    });

    it('renders points activity history table with types, amounts, and running balances', () => {
        render(
            <ProfileClient
                userName="Alex Traveler"
                userAvatar="avatar.png"
                accountTimeZone="UTC"
                accountTimeZoneChoices={['UTC', 'America/Los_Angeles']}
                currentStatus="Gold"
                currentPoints={4200}
                spendablePointsBalance={58750}
                pointsLedgerEntries={sampleLedgerEntries}
                bookings={[]}
                favorites={[]}
                reviews={[]}
                activityData={[]}
                monthlyHistory={[]}
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
            />
        );

        const section = screen.getByTestId('points-ledger-section');
        expect(section).toBeInTheDocument();
        expect(within(section).getByText('Points Activity History')).toBeInTheDocument();
        expect(within(section).getByText('Times shown in UTC')).toBeInTheDocument();

        // Badges
        expect(within(section).getByTestId('badge-WELCOME_GRANT')).toHaveTextContent('Welcome Grant');
        expect(within(section).getByTestId('badge-FLIGHT_EARN')).toHaveTextContent('Flight Earn');
        expect(within(section).getByTestId('badge-REWARD_REDEMPTION')).toHaveTextContent('Redemption');
        expect(within(section).getByTestId('badge-REWARD_REFUND')).toHaveTextContent('Refund');

        // Positive and negative amounts
        expect(within(section).getByText('+10,000')).toBeInTheDocument();
        expect(within(section).getByText('+1,750')).toBeInTheDocument();
        expect(within(section).getByText('-15,000')).toBeInTheDocument();
        expect(within(section).getByText('+12,000')).toBeInTheDocument();

        // Balances
        expect(within(section).getByText('10,000 pts')).toBeInTheDocument();
        expect(within(section).getByText('11,750 pts')).toBeInTheDocument();
        expect(within(section).getByText('46,750 pts')).toBeInTheDocument();
        expect(within(section).getByText('58,750 pts')).toBeInTheDocument();
    });

    it('renders empty message when no points ledger entries exist', () => {
        render(
            <ProfileClient
                userName="Alex Traveler"
                userAvatar="avatar.png"
                accountTimeZone="UTC"
                accountTimeZoneChoices={['UTC', 'America/Los_Angeles']}
                currentStatus="Bronze"
                currentPoints={0}
                spendablePointsBalance={0}
                pointsLedgerEntries={[]}
                bookings={[]}
                favorites={[]}
                reviews={[]}
                activityData={[]}
                monthlyHistory={[]}
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
            />
        );

        expect(screen.getByTestId('points-ledger-empty'))
            .toHaveTextContent('No reward points activity recorded yet.');
    });
});

describe('PointsLedgerTable pagination and interaction', () => {
    it('paginates entries interactively', () => {
        render(
            <PointsLedgerTable
                entries={sampleLedgerEntries}
                accountTimeZone="UTC"
                pageSize={2}
            />
        );

        const pagination = screen.getByTestId('points-ledger-pagination');
        expect(pagination).toHaveTextContent('Page 1 of 2');

        // First page shows first 2 entries
        expect(screen.getByText('Welcome grant')).toBeInTheDocument();
        expect(screen.getByText('Points earned for flight booking #MA-1111')).toBeInTheDocument();
        expect(screen.queryByText('Redemption for booking #MA-2222')).not.toBeInTheDocument();

        const prevBtn = screen.getByRole('button', { name: 'Previous' });
        const nextBtn = screen.getByRole('button', { name: 'Next' });
        expect(prevBtn).toBeDisabled();
        expect(nextBtn).not.toBeDisabled();

        // Click next
        fireEvent.click(nextBtn);

        expect(screen.getByTestId('points-ledger-pagination')).toHaveTextContent('Page 2 of 2');
        expect(screen.queryByText('Welcome grant')).not.toBeInTheDocument();
        expect(screen.getByText('Redemption for booking #MA-2222')).toBeInTheDocument();
        expect(screen.getByText('Cancellation refund for booking #102')).toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

        // Click previous
        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        expect(screen.getByTestId('points-ledger-pagination')).toHaveTextContent('Page 1 of 2');
        expect(screen.getByText('Welcome grant')).toBeInTheDocument();
    });

    it('formats dates in the selected account timezone', () => {
        render(
            <PointsLedgerTable
                entries={[sampleLedgerEntries[0]]}
                accountTimeZone="America/Los_Angeles"
            />
        );

        // 2026-06-01T10:00:00Z in America/Los_Angeles (PDT, UTC-7) is 3:00 AM PDT
        const row = screen.getByTestId('ledger-row-ple-1');
        expect(row).toHaveTextContent('June 1, 2026');
        expect(row).toHaveTextContent('PDT');
    });
});
