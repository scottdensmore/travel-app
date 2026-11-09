import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PointsActivityTable from '@/components/ui/pointsActivityTable';

describe('PointsActivityTable', () => {
    it('labels activity instants with the saved account timezone', () => {
        render(
            <PointsActivityTable
                accountTimeZone="America/Los_Angeles"
                activityData={[{
                    description: 'Flight booking',
                    date: 'December 31, 2025 at 4:30 PM PST',
                    points: 100,
                }]}
            />,
        );

        expect(screen.getByRole('columnheader', {
            name: 'Activity time (America/Los_Angeles)',
        })).toBeInTheDocument();
        expect(screen.getByText('December 31, 2025 at 4:30 PM PST'))
            .toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Recent points activity' }))
            .toHaveAttribute('tabindex', '0');
    });

    it('filters displayed table rows when searching by description, date, or points', () => {
        render(
            <PointsActivityTable
                accountTimeZone="America/Los_Angeles"
                activityData={[
                    {
                        description: 'Flight booking SFO-JFK',
                        date: 'December 31, 2025 at 4:30 PM PST',
                        points: 1200,
                    },
                    {
                        description: 'Lounge access redemption',
                        date: 'January 15, 2026 at 10:00 AM PST',
                        points: -500,
                    },
                ]}
            />,
        );

        const searchInput = screen.getByTestId('points-activity-search');
        expect(searchInput).toHaveAttribute('aria-label', 'Search recent points activity');

        fireEvent.change(searchInput, { target: { value: 'lounge' } });
        expect(screen.getByText('Lounge access redemption')).toBeInTheDocument();
        expect(screen.queryByText('Flight booking SFO-JFK')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'December 31' } });
        expect(screen.getByText('Flight booking SFO-JFK')).toBeInTheDocument();
        expect(screen.queryByText('Lounge access redemption')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: '-500' } });
        expect(screen.getByText('Lounge access redemption')).toBeInTheDocument();
        expect(screen.queryByText('Flight booking SFO-JFK')).not.toBeInTheDocument();
    });

    it('renders no matching points activity message when no rows match the search query', () => {
        render(
            <PointsActivityTable
                accountTimeZone="America/Los_Angeles"
                activityData={[
                    {
                        description: 'Flight booking',
                        date: 'December 31, 2025 at 4:30 PM PST',
                        points: 100,
                    },
                ]}
            />,
        );

        const searchInput = screen.getByTestId('points-activity-search');
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        expect(screen.getByTestId('points-activity-no-matches'))
            .toHaveTextContent('No matching points activity found.');
        expect(screen.queryByText('Flight booking')).not.toBeInTheDocument();
    });

    it('updates rows and timezone without losing the active search', () => {
        const { rerender } = render(
            <PointsActivityTable
                accountTimeZone="UTC"
                activityData={[
                    { description: 'Flight booking', date: 'April 1', points: 1200 },
                    { description: 'Lounge access', date: 'April 2', points: -500 },
                ]}
            />,
        );
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' lounge ' } });
        expect(screen.getByText('Lounge access')).toBeInTheDocument();
        expect(screen.queryByText('Flight booking')).not.toBeInTheDocument();

        rerender(
            <PointsActivityTable
                accountTimeZone="America/New_York"
                activityData={[
                    { description: 'Lounge refund', date: 'April 3', points: 500 },
                    { description: 'Flight refund', date: 'April 4', points: -1200 },
                ]}
            />,
        );
        expect(screen.getByRole('searchbox')).toHaveValue(' lounge ');
        expect(screen.getByRole('columnheader', {
            name: 'Activity time (America/New_York)',
        })).toBeInTheDocument();
        expect(screen.getByText('Lounge refund')).toBeInTheDocument();
        expect(screen.queryByText('Lounge access')).not.toBeInTheDocument();
        expect(screen.queryByText('Flight refund')).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
        expect(screen.getByText('Flight refund')).toBeInTheDocument();
    });
});

