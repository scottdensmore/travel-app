import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleOccurrencesTableClient, {
    type ScheduleOccurrencesTableRow,
} from '@/components/admin/ScheduleOccurrencesTableClient';

const SAMPLE_OCCURRENCES: ScheduleOccurrencesTableRow[] = [
    {
        id: 71,
        flightNumber: 'MA237',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date('2026-08-16T15:00:00.000Z'),
        durationMinutes: null,
        priceCents: 35_000,
        status: 'ON_TIME',
        bookingIds: [],
        hasActiveCheckout: false,
        eligibility: 'HISTORICAL',
        category: 'PAST',
    },
    {
        id: 72,
        flightNumber: 'MA238',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date('2026-08-18T15:00:00.000Z'),
        durationMinutes: 245,
        priceCents: 35_000,
        status: 'ON_TIME',
        bookingIds: [91],
        hasActiveCheckout: false,
        eligibility: 'BOOKING_HISTORY',
        category: 'BOOKED_FUTURE',
    },
    {
        id: 73,
        flightNumber: 'MA239',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date('2026-08-20T15:00:00.000Z'),
        durationMinutes: 245,
        priceCents: 35_000,
        status: 'DELAYED',
        bookingIds: [],
        hasActiveCheckout: false,
        eligibility: 'OPERATIONAL_OVERRIDE',
    },
    {
        id: 74,
        flightNumber: 'MA240',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date('2026-08-21T15:00:00.000Z'),
        durationMinutes: 245,
        priceCents: 35_000,
        status: 'ON_TIME',
        bookingIds: [],
        hasActiveCheckout: false,
        eligibility: 'SAFE_FUTURE',
        category: 'SAFE_FUTURE',
        awardSeatsFirst: 1,
        awardSeatsBusiness: 2,
        awardSeatsPremiumEconomy: 3,
        awardSeatsEconomy: 5,
    },
];

describe('ScheduleOccurrencesTableClient', () => {
    it('renders empty state when occurrences is empty and hides filter controls', () => {
        render(<ScheduleOccurrencesTableClient occurrences={[]} />);

        expect(
            screen.getByText('No linked occurrences exist for this template.'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('schedule-occurrences-search')).not.toBeInTheDocument();
        expect(
            screen.queryByTestId('schedule-occurrences-category-filter'),
        ).not.toBeInTheDocument();
    });

    it('renders occurrences and category filter options when occurrences are present', () => {
        render(<ScheduleOccurrencesTableClient occurrences={SAMPLE_OCCURRENCES} />);

        expect(screen.getByText('Mona Airways MA237')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA238')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA239')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA240')).toBeInTheDocument();
        expect(screen.getByText('Award seats: 1F · 2J · 3W · 5Y')).toBeInTheDocument();

        const categorySelect = screen.getByTestId(
            'schedule-occurrences-category-filter',
        ) as HTMLSelectElement;
        const options = Array.from(categorySelect.options).map((opt) => ({
            value: opt.value,
            text: opt.text,
        }));
        expect(options).toEqual([
            { value: 'ALL', text: 'All Categories' },
            { value: 'SAFE_FUTURE', text: 'Will update (SAFE_FUTURE)' },
            { value: 'BOOKED_FUTURE', text: 'Protected — booked (BOOKED_FUTURE)' },
            { value: 'PAST', text: 'Protected — past/departed (PAST)' },
        ]);
    });

    it('filters occurrences by impact category (SAFE_FUTURE, BOOKED_FUTURE, PAST)', () => {
        render(<ScheduleOccurrencesTableClient occurrences={SAMPLE_OCCURRENCES} />);

        const categorySelect = screen.getByTestId('schedule-occurrences-category-filter');

        fireEvent.change(categorySelect, { target: { value: 'SAFE_FUTURE' } });
        expect(screen.getByText('Mona Airways MA240')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA237')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA238')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA239')).not.toBeInTheDocument();

        fireEvent.change(categorySelect, { target: { value: 'BOOKED_FUTURE' } });
        expect(screen.getByText('Mona Airways MA238')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA239')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA237')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA240')).not.toBeInTheDocument();

        fireEvent.change(categorySelect, { target: { value: 'PAST' } });
        expect(screen.getByText('Mona Airways MA237')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA238')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA239')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA240')).not.toBeInTheDocument();

        fireEvent.change(categorySelect, { target: { value: 'ALL' } });
        expect(screen.getByText('Mona Airways MA237')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA238')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA239')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA240')).toBeInTheDocument();
    });

    it('searches occurrences by status, departure date, or impact label/description', () => {
        render(<ScheduleOccurrencesTableClient occurrences={SAMPLE_OCCURRENCES} />);

        const searchInput = screen.getByTestId('schedule-occurrences-search');

        fireEvent.change(searchInput, { target: { value: 'delayed' } });
        expect(screen.getByText('Mona Airways MA239')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA237')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA238')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA240')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: '2026-08-18' } });
        expect(screen.getByText('Mona Airways MA238')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA237')).not.toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA239')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'booking history' } });
        expect(screen.getByText('Mona Airways MA238')).toBeInTheDocument();
        expect(screen.getByText('Mona Airways MA240')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA237')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'before this preview time' } });
        expect(screen.getByText('Mona Airways MA237')).toBeInTheDocument();
        expect(screen.queryByText('Mona Airways MA240')).not.toBeInTheDocument();
    });

    it('renders "No occurrences match the current filters." when no occurrences match', () => {
        render(<ScheduleOccurrencesTableClient occurrences={SAMPLE_OCCURRENCES} />);

        const searchInput = screen.getByTestId('schedule-occurrences-search');
        fireEvent.change(searchInput, { target: { value: 'nonexistent-filter-query' } });

        expect(
            screen.getByText('No occurrences match the current filters.'),
        ).toBeInTheDocument();
        expect(
            screen.queryByText('No linked occurrences exist for this template.'),
        ).not.toBeInTheDocument();
    });
});
