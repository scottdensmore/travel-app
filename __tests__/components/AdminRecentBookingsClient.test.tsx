import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminRecentBookingsClient, { AdminRecentBookingItem } from '@/components/admin/AdminRecentBookingsClient';

const SAMPLE_BOOKINGS: AdminRecentBookingItem[] = [
    {
        id: 901,
        createdAt: '2026-06-20T10:00:00.000Z',
        isRewardBooking: true,
        user: { name: 'Ada Lovelace', email: 'ada@example.com' },
        legs: [
            {
                sequence: 1,
                flight: {
                    airline: 'Mona Airways',
                    flightNumber: 'MA100',
                    from: 'Seattle, USA',
                    to: 'Tokyo, Japan',
                },
            },
        ],
    },
    {
        id: 902,
        createdAt: '2026-06-21T12:00:00.000Z',
        isRewardBooking: false,
        user: { name: null, email: 'grace.hopper@example.com' },
        legs: [
            {
                sequence: 1,
                flight: {
                    airline: 'Pacific Star',
                    flightNumber: 'PS240',
                    fromAirport: { label: 'New York, USA' },
                    toAirport: { label: 'London, UK' },
                },
            },
        ],
    },
    {
        id: 903,
        createdAt: '2026-06-22T15:30:00.000Z',
        isRewardBooking: false,
        user: { name: 'Alan Turing', email: 'alan@example.com' },
        legs: [
            {
                sequence: 1,
                flight: {
                    airline: 'Mona Airways',
                    flightNumber: 'MA515',
                    from: 'Paris, France',
                    to: 'Rome, Italy',
                },
            },
        ],
    },
];

describe('AdminRecentBookingsClient', () => {
    it('renders "No bookings yet." when bookings is empty and hides filter controls', () => {
        render(<AdminRecentBookingsClient bookings={[]} />);

        expect(screen.getByText('No bookings yet.')).toBeInTheDocument();
        expect(screen.queryByTestId('admin-recent-bookings-search')).not.toBeInTheDocument();
        expect(screen.queryByTestId('admin-recent-bookings-type-filter')).not.toBeInTheDocument();
    });

    it('renders recent cash and reward bookings with Reward badge and filter options', () => {
        render(<AdminRecentBookingsClient bookings={SAMPLE_BOOKINGS} />);

        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('grace.hopper@example.com')).toBeInTheDocument();
        expect(screen.getByText('Alan Turing')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA100')).toBeInTheDocument();
        expect(screen.getByText('Pacific Star PS240')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA515')).toBeInTheDocument();
        expect(screen.getByText('Seattle, USA → Tokyo, Japan')).toBeInTheDocument();
        expect(screen.getByText('New York, USA → London, UK')).toBeInTheDocument();
        expect(screen.getByText('Paris, France → Rome, Italy')).toBeInTheDocument();
        expect(screen.getAllByText('Reward')).toHaveLength(1);

        const typeSelect = screen.getByTestId('admin-recent-bookings-type-filter') as HTMLSelectElement;
        const options = Array.from(typeSelect.options).map((opt) => ({
            value: opt.value,
            text: opt.text,
        }));
        expect(options).toEqual([
            { value: 'ALL', text: 'All Bookings' },
            { value: 'REWARD', text: 'Reward Only' },
            { value: 'CASH', text: 'Cash Only' },
        ]);
    });

    it('filters bookings by Reward Only and Cash Only', () => {
        render(<AdminRecentBookingsClient bookings={SAMPLE_BOOKINGS} />);

        const typeSelect = screen.getByTestId('admin-recent-bookings-type-filter');

        fireEvent.change(typeSelect, { target: { value: 'REWARD' } });
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.queryByText('grace.hopper@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();

        fireEvent.change(typeSelect, { target: { value: 'CASH' } });
        expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
        expect(screen.getByText('grace.hopper@example.com')).toBeInTheDocument();
        expect(screen.getByText('Alan Turing')).toBeInTheDocument();

        fireEvent.change(typeSelect, { target: { value: 'ALL' } });
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('grace.hopper@example.com')).toBeInTheDocument();
        expect(screen.getByText('Alan Turing')).toBeInTheDocument();
    });

    it('searches bookings by customer name/email, flight number, or route case-insensitively', () => {
        render(<AdminRecentBookingsClient bookings={SAMPLE_BOOKINGS} />);

        const searchInput = screen.getByTestId('admin-recent-bookings-search');

        fireEvent.change(searchInput, { target: { value: 'lovelace' } });
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'GRACE.HOPPER' } });
        expect(screen.getByText('grace.hopper@example.com')).toBeInTheDocument();
        expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'ma515' } });
        expect(screen.getByText('Alan Turing')).toBeInTheDocument();
        expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: '  tokyo  ' } });
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'new york' } });
        expect(screen.getByText('grace.hopper@example.com')).toBeInTheDocument();
        expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    });

    it('renders "No recent bookings match the current filters." when no bookings match', () => {
        render(<AdminRecentBookingsClient bookings={SAMPLE_BOOKINGS} />);

        const searchInput = screen.getByTestId('admin-recent-bookings-search');
        fireEvent.change(searchInput, { target: { value: 'ZZ999' } });

        expect(screen.getByText('No recent bookings match the current filters.')).toBeInTheDocument();
        expect(screen.queryByText('No bookings yet.')).not.toBeInTheDocument();
    });
});
