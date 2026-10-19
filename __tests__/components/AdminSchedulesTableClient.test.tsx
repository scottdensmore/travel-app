import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminSchedulesTableClient, { AdminScheduleItem } from '@/components/admin/AdminSchedulesTableClient';

const SAMPLE_SCHEDULES: AdminScheduleItem[] = [
    {
        id: 17,
        flightNumber: 'MA237',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureTime: '08:00',
        durationMinutes: 245,
        daysOfWeek: [1, 3, 5],
        priceCents: 35_000,
        isActive: true,
    },
    {
        id: 18,
        flightNumber: 'MA680',
        airline: 'Pacific Star',
        from: 'Tokyo, Japan',
        to: 'San Francisco, USA',
        departureTime: '17:00',
        durationMinutes: 680,
        daysOfWeek: [2, 4],
        priceCents: 120_000,
        isActive: false,
        awardSeatsFirst: 2,
        awardSeatsBusiness: 4,
        awardSeatsPremiumEconomy: 3,
        awardSeatsEconomy: 8,
    },
    {
        id: 19,
        flightNumber: 'MA412',
        airline: 'Mona Airways',
        from: 'London, UK',
        to: 'Paris, France',
        departureTime: '11:30',
        durationMinutes: 75,
        daysOfWeek: [0, 6],
        priceCents: 18_500,
    },
];

describe('AdminSchedulesTableClient', () => {
    it('renders empty state when schedules is empty and hides filter controls', () => {
        render(<AdminSchedulesTableClient schedules={[]} />);

        expect(
            screen.getByText('No flight templates declared yet. Use the form on the left to add one!')
        ).toBeInTheDocument();
        expect(screen.queryByTestId('admin-schedules-search')).not.toBeInTheDocument();
        expect(screen.queryByTestId('admin-schedules-status-filter')).not.toBeInTheDocument();
    });

    it('renders templates and status filter options when schedules are present', () => {
        render(<AdminSchedulesTableClient schedules={SAMPLE_SCHEDULES} />);

        expect(screen.getByText('MA237')).toBeInTheDocument();
        expect(screen.getByText('MA680')).toBeInTheDocument();
        expect(screen.getByText('MA412')).toBeInTheDocument();
        expect(screen.getAllByText('Award: 1F / 2J / 2W / 4Y')).toHaveLength(2);
        expect(screen.getByText('Award: 2F / 4J / 3W / 8Y')).toBeInTheDocument();

        const statusSelect = screen.getByTestId('admin-schedules-status-filter') as HTMLSelectElement;
        const options = Array.from(statusSelect.options).map((opt) => ({
            value: opt.value,
            text: opt.text,
        }));
        expect(options).toEqual([
            { value: 'ALL', text: 'All Templates' },
            { value: 'ACTIVE', text: 'Active Only' },
            { value: 'PAUSED', text: 'Paused Only' },
        ]);
    });

    it('filters templates by flight number, airline, or route case-insensitively', () => {
        render(<AdminSchedulesTableClient schedules={SAMPLE_SCHEDULES} />);

        const searchInput = screen.getByTestId('admin-schedules-search');

        fireEvent.change(searchInput, { target: { value: 'ma680' } });
        expect(screen.getByText('MA680')).toBeInTheDocument();
        expect(screen.queryByText('MA237')).not.toBeInTheDocument();
        expect(screen.queryByText('MA412')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: '  detroit  ' } });
        expect(screen.getByText('MA237')).toBeInTheDocument();
        expect(screen.queryByText('MA680')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'pacific star' } });
        expect(screen.getByText('MA680')).toBeInTheDocument();
        expect(screen.queryByText('MA237')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'london' } });
        expect(screen.getByText('MA412')).toBeInTheDocument();
        expect(screen.queryByText('MA237')).not.toBeInTheDocument();
    });

    it('filters templates by Active Only and Paused Only status', () => {
        render(<AdminSchedulesTableClient schedules={SAMPLE_SCHEDULES} />);

        const statusSelect = screen.getByTestId('admin-schedules-status-filter');

        fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });
        expect(screen.getByText('MA237')).toBeInTheDocument();
        expect(screen.getByText('MA412')).toBeInTheDocument();
        expect(screen.queryByText('MA680')).not.toBeInTheDocument();

        fireEvent.change(statusSelect, { target: { value: 'PAUSED' } });
        expect(screen.getByText('MA680')).toBeInTheDocument();
        expect(screen.queryByText('MA237')).not.toBeInTheDocument();
        expect(screen.queryByText('MA412')).not.toBeInTheDocument();

        fireEvent.change(statusSelect, { target: { value: 'ALL' } });
        expect(screen.getByText('MA237')).toBeInTheDocument();
        expect(screen.getByText('MA680')).toBeInTheDocument();
        expect(screen.getByText('MA412')).toBeInTheDocument();
    });

    it('renders "No flight templates match the current filters." when no templates match', () => {
        render(<AdminSchedulesTableClient schedules={SAMPLE_SCHEDULES} />);

        const searchInput = screen.getByTestId('admin-schedules-search');
        fireEvent.change(searchInput, { target: { value: 'ZZ999' } });

        expect(screen.getByText('No flight templates match the current filters.')).toBeInTheDocument();
        expect(
            screen.queryByText('No flight templates declared yet. Use the form on the left to add one!')
        ).not.toBeInTheDocument();
    });
});
