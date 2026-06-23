/** @jest-environment node */
import PointsActivityService from '@/lib/PointsActivityService';

describe('PointsActivityService dynamic calculations', () => {
    const mockBookings: any[] = [
        {
            id: 1,
            createdAt: new Date('2026-01-15'),
            flight: {
                id: 10,
                airline: 'Gemini Airways',
                flightNumber: 'GA101',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                price: '$350',
            }
        },
        {
            id: 2,
            createdAt: new Date('2026-02-20'),
            flight: {
                id: 11,
                airline: 'Delta',
                flightNumber: 'DL202',
                from: 'Detroit, USA',
                to: 'New York, USA',
                price: '250',
            }
        }
    ];

    it('calculates points and activities with default starting points and bookings', () => {
        const service = new PointsActivityService(mockBookings, 1000);
        
        expect(service.getCurrentPoints()).toBe(1600); // 1000 + 350 + 250
        expect(service.getCurrentStatus()).toBe('Silver'); // 1600 fits Silver tier (>= 1000 and < 3000)

        const activities = service.getPointsActivity();
        expect(activities).toHaveLength(3); // 2 bookings + 1 starting points
        expect(activities[0]).toEqual({
            description: '✈️ Gemini Airways GA101 (Seattle, USA → Detroit, USA)',
            date: new Date('2026-01-15').toLocaleDateString(),
            points: 350,
        });
        expect(activities[1]).toEqual({
            description: '✈️ Delta DL202 (Detroit, USA → New York, USA)',
            date: new Date('2026-02-20').toLocaleDateString(),
            points: 250,
        });
        expect(activities[2]).toEqual({
            description: 'Starting Points',
            date: '',
            points: 1000,
        });
    });

    it('assigns correct statuses based on thresholds', () => {
        // Bronze < 1000
        expect(new PointsActivityService([], 500).getCurrentStatus()).toBe('Bronze');
        // Silver >= 1000 and < 3000
        expect(new PointsActivityService([], 1500).getCurrentStatus()).toBe('Silver');
        // Gold >= 3000 and < 6000
        expect(new PointsActivityService([], 4500).getCurrentStatus()).toBe('Gold');
        // Platinum >= 6000
        expect(new PointsActivityService([], 7000).getCurrentStatus()).toBe('Platinum');
    });

    it('aggregates points history monthly', () => {
        const service = new PointsActivityService(mockBookings, 1000);
        const monthly = service.getMonthlyPointsActivity();

        // Should return monthly accumulation (e.g. Starting points month, Jan, Feb)
        expect(monthly.length).toBeGreaterThanOrEqual(2);
        // Last element should show final total points cumulative
        expect(monthly[monthly.length - 1].points).toBe(1600);
    });
});
