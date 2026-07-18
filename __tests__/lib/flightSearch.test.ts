import { buildFlightRoutes } from '@/lib/flightSearch';

describe('buildFlightRoutes', () => {
    it('uses the nearest future operating date across active route schedules', () => {
        const routes = buildFlightRoutes([
            {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                daysOfWeek: [2],
            },
            {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '18:00',
                daysOfWeek: [2],
            },
            {
                from: 'New York, USA',
                to: 'London, UK',
                departureTime: '19:30',
                daysOfWeek: [4, 6],
            },
        ], new Date('2026-07-14T12:00:00.000Z'));

        expect(routes).toEqual([
            {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                nextOperatingDate: '2026-07-14',
            },
            {
                from: 'New York, USA',
                to: 'London, UK',
                nextOperatingDate: '2026-07-16',
            },
        ]);
    });

    it('moves to the next operating day when todays departure has passed', () => {
        const routes = buildFlightRoutes([
            {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                daysOfWeek: [2, 5],
            },
        ], new Date('2026-07-14T12:00:00.000Z'));

        expect(routes[0]?.nextOperatingDate).toBe('2026-07-17');
    });
});
