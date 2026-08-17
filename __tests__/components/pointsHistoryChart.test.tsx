import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PointsHistoryChart from '@/components/ui/charts/pointsHistoryChart';

describe('PointsHistoryChart', () => {
    it('labels month aggregation with the saved account timezone', () => {
        render(
            <PointsHistoryChart
                accountTimeZone="America/Los_Angeles"
                chartData={[
                    { description: 'Nov 2025', date: 'Nov 2025', points: 1000 },
                    { description: 'Dec 2025', date: 'Dec 2025', points: 1250 },
                ]}
            />,
        );

        expect(screen.getByText('Monthly points accumulation in America/Los_Angeles'))
            .toBeInTheDocument();
        const chart = screen.getByRole('list', {
            name: 'Monthly points history in America/Los_Angeles',
        });
        expect(chart).toHaveTextContent('Nov 2025');
        expect(chart).toHaveTextContent('1,000 points');
        expect(chart).toHaveTextContent('Dec 2025');
        expect(chart).toHaveTextContent('1,250 points');
        const bars = chart.querySelectorAll('.points-history-bar');
        expect(bars).toHaveLength(2);
        expect(bars[0]).toHaveStyle({ width: '80%' });
        expect(bars[1]).toHaveStyle({ width: '100%' });
    });
});
