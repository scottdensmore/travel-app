import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
