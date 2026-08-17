/** @jest-environment node */
import PointsActivityService from '@/lib/PointsActivityService';

describe('PointsActivityService dynamic calculations', () => {
    const mockBookings: any[] = [
        {
            id: 1,
            createdAt: new Date('2026-01-15'),
            legs: [{ sequence: 1, flight: {
                id: 10,
                airline: 'Gemini Airways',
                flightNumber: 'GA101',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                priceCents: 35000,
            } }]
        },
        {
            id: 2,
            createdAt: new Date('2026-02-20'),
            legs: [{ sequence: 1, flight: {
                id: 11,
                airline: 'Delta',
                flightNumber: 'DL202',
                from: 'Detroit, USA',
                to: 'New York, USA',
                priceCents: 25000,
            } }]
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
            date: 'January 15, 2026 at 12:00 AM UTC',
            points: 350,
        });
        expect(activities[1]).toEqual({
            description: '✈️ Delta DL202 (Detroit, USA → New York, USA)',
            date: 'February 20, 2026 at 12:00 AM UTC',
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

    it('formats activity instants and month boundaries in the saved account timezone', () => {
        const service = new PointsActivityService([{
            id: 5,
            createdAt: new Date('2026-01-01T00:30:00.000Z'),
            status: 'CONFIRMED',
            totalPriceCents: 10_000,
            legs: [],
        } as any], 0, 'America/Los_Angeles');

        expect(service.getPointsActivity()[0].date)
            .toBe('December 31, 2025 at 4:30 PM PST');
        expect(service.getMonthlyPointsActivity().map(row => row.date))
            .toEqual(['Nov 2025', 'Dec 2025']);
    });

    it('falls back to UTC when a legacy account timezone is not recognized', () => {
        const service = new PointsActivityService([{
            id: 7,
            createdAt: new Date('2026-01-01T00:30:00.000Z'),
            status: 'CONFIRMED',
            totalPriceCents: 10_000,
            legs: [],
        } as any], 0, 'Not/AZone');

        expect(service.getPointsActivity()[0].date)
            .toBe('January 1, 2026 at 12:30 AM UTC');
        expect(service.getMonthlyPointsActivity().map(row => row.date))
            .toEqual(['Dec 2025', 'Jan 2026']);
    });

    it('uses the booking total in preference to the flight price', () => {
        const mockBookingsWithTotalPrice: any[] = [
            {
                id: 3,
                createdAt: new Date('2026-03-10'),
                totalPriceCents: 45000,
                legs: [{ sequence: 1, flight: {
                    id: 12,
                    airline: 'Gemini Airways',
                    flightNumber: 'GA103',
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    priceCents: 15000,
                } }]
            }
        ];
        const service = new PointsActivityService(mockBookingsWithTotalPrice, 500);
        expect(service.getCurrentPoints()).toBe(950); // 500 starting + 450 from the booking total

        const activities = service.getPointsActivity();
        expect(activities[0].points).toBe(450);
    });

    it('awards whole-dollar points for authoritative decimal fares', () => {
        const service = new PointsActivityService([{
            id: 4,
            createdAt: new Date('2026-03-11'),
            status: 'CONFIRMED',
            totalPriceCents: 6997,
            legs: []
        } as any], 500);

        expect(service.getCurrentPoints()).toBe(569);
        expect(service.getPointsActivity()[0].points).toBe(69);
    });

    it('correctly handles CANCELLED bookings by not counting points and rendering negative log rows', () => {
        const bookingsWithCancelled: any[] = [
            {
                id: 1,
                createdAt: new Date('2026-01-15'),
                status: 'CANCELLED',
                totalPriceCents: 35000,
                legs: [{ sequence: 1, flight: {
                    id: 10,
                    airline: 'Gemini Airways',
                    flightNumber: 'GA101',
                    from: 'Seattle, USA',
                    to: 'Detroit, USA',
                    priceCents: 35000,
                } }]
            }
        ];
        const service = new PointsActivityService(bookingsWithCancelled, 1000);

        // Cancelled booking points should NOT be added to total points balance
        expect(service.getCurrentPoints()).toBe(1000); 

        // Activities log should render both booking credit and cancellation debit
        const activities = service.getPointsActivity();
        expect(activities).toHaveLength(3); // 1 booking positive + 1 booking negative + 1 starting points
        expect(activities[0]).toEqual({
            description: '✈️ Gemini Airways GA101 (Seattle, USA → Detroit, USA)',
            date: 'January 15, 2026 at 12:00 AM UTC',
            points: 350,
        });
        expect(activities[1]).toEqual({
            description: '❌ Cancelled: Gemini Airways GA101 (Seattle, USA → Detroit, USA)',
            date: 'January 15, 2026 at 12:00 AM UTC',
            points: -350,
        });
        expect(activities[2].description).toBe('Starting Points');

        // Monthly points chart should balance out to 0 net points for the cancelled booking
        const monthly = service.getMonthlyPointsActivity();
        expect(monthly[monthly.length - 1].points).toBe(1000); // 1000 starting + 350 (credit) - 350 (debit)
    });

    it('dates a cancellation debit at the cancellation event rather than ticket issuance', () => {
        const service = new PointsActivityService([{
            id: 6,
            createdAt: new Date('2026-06-30T18:00:00.000Z'),
            status: 'CANCELLED',
            totalPriceCents: 35_000,
            legs: [],
            statusChanges: [{ createdAt: new Date('2026-07-01T08:30:00.000Z') }],
        } as any], 1000, 'America/Los_Angeles');

        expect(service.getPointsActivity().slice(0, 2).map(activity => activity.date))
            .toEqual([
                'June 30, 2026 at 11:00 AM PDT',
                'July 1, 2026 at 1:30 AM PDT',
            ]);
        expect(service.getMonthlyPointsActivity()).toEqual([
            { description: 'May 2026', date: 'May 2026', points: 1000 },
            { description: 'Jun 2026', date: 'Jun 2026', points: 1350 },
            { description: 'Jul 2026', date: 'Jul 2026', points: 1000 },
        ]);
    });
});
