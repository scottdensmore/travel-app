import { buildFlightRoutes, findNearbyOperatingDates } from '@/lib/flightSearch';

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

describe('findNearbyOperatingDates', () => {
    it('returns the nearest earlier and later operating dates', () => {
        expect(findNearbyOperatingDates([
            { flightNumber: 'CA101', departureTime: '08:00', daysOfWeek: [1, 3, 5] },
        ], '2026-07-16', new Date('2026-07-14T12:00:00.000Z'))).toEqual([
            '2026-07-15',
            '2026-07-17',
        ]);
    });

    it('excludes past and already-departed candidates', () => {
        expect(findNearbyOperatingDates([
            { flightNumber: 'CA101', departureTime: '08:00', daysOfWeek: [2, 4] },
        ], '2026-07-15', new Date('2026-07-14T12:00:00.000Z'))).toEqual([
            '2026-07-16',
        ]);
    });

    it('does not suggest dates beyond the booking window', () => {
        expect(findNearbyOperatingDates([
            { flightNumber: 'CA101', departureTime: '08:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
        ], '2027-07-14', new Date('2026-07-14T12:00:00.000Z'))).toEqual([
            '2027-07-13',
        ]);
    });

    it('skips operating dates whose scheduled occurrence is cancelled', () => {
        expect(findNearbyOperatingDates([
            { flightNumber: 'CA101', departureTime: '08:00', daysOfWeek: [1, 3, 5] },
        ], '2026-07-16', new Date('2026-07-01T12:00:00.000Z'), [
            {
                flightNumber: 'CA101',
                departureDate: new Date('2026-07-15T08:00:00.000Z'),
            },
        ])).toEqual([
            '2026-07-13',
            '2026-07-17',
        ]);
    });
});
