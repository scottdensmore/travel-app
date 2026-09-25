import {
    buildFlightSearchUrl,
    isUnusableSearchLink,
    parseFlightSearchParams,
    parseFlightSearchUrl,
    type FlightSearchCriteria,
} from '@/lib/flightSearchUrl';

const routes = [
    { from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' },
    { from: 'New York, USA', to: 'London, UK', nextOperatingDate: '2026-07-18' },
];

const bookingWindow = {
    earliestDate: '2026-07-14',
    latestDate: '2027-07-14',
};

describe('flightSearchUrl reward search criteria', () => {
    describe('buildFlightSearchUrl with reward search', () => {
        it('appends reward=true when isRewardSearch is true', () => {
            const criteria: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY',
                isRewardSearch: true,
            };

            const url = buildFlightSearchUrl(criteria, '/');
            expect(url).toBe('/?from=SEA&to=DTW&depart=2026-07-18&trip=one-way&reward=true');
        });

        it('omits reward parameter when isRewardSearch is false or undefined', () => {
            const criteriaFalse: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY',
                isRewardSearch: false,
            };
            expect(buildFlightSearchUrl(criteriaFalse, '/')).not.toContain('reward');

            const criteriaUndefined: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY',
            };
            expect(buildFlightSearchUrl(criteriaUndefined, '/')).not.toContain('reward');
        });

        it('supports round-trip and non-economy cabin with reward=true', () => {
            const criteria: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '2026-07-25',
                tripType: 'round-trip',
                cabinClass: 'BUSINESS',
                isRewardSearch: true,
            };

            const url = buildFlightSearchUrl(criteria, '/flights');
            expect(url).toBe('/flights?from=SEA&to=DTW&depart=2026-07-18&return=2026-07-25&trip=round-trip&cabin=BUSINESS&reward=true');
        });
    });

    describe('parseFlightSearchParams with reward search', () => {
        it('parses reward=true as isRewardSearch: true', () => {
            const parsed = parseFlightSearchParams({
                from: 'SEA',
                to: 'DTW',
                depart: '2026-07-18',
                trip: 'one-way',
                reward: 'true',
            }, routes, bookingWindow);

            expect(parsed).toBeDefined();
            expect(parsed?.isRewardSearch).toBe(true);
            expect(parsed?.from).toBe('Seattle, USA');
            expect(parsed?.to).toBe('Detroit, USA');
        });

        it('does not set isRewardSearch when reward param is absent', () => {
            const parsed = parseFlightSearchParams({
                from: 'SEA',
                to: 'DTW',
                depart: '2026-07-18',
                trip: 'one-way',
            }, routes, bookingWindow);

            expect(parsed).toBeDefined();
            expect(parsed?.isRewardSearch).toBeUndefined();
        });

        it('does not set isRewardSearch to true when reward param is false', () => {
            const parsed = parseFlightSearchParams({
                from: 'SEA',
                to: 'DTW',
                depart: '2026-07-18',
                trip: 'one-way',
                reward: 'false',
            }, routes, bookingWindow);

            expect(parsed).toBeDefined();
            expect(parsed?.isRewardSearch).toBeUndefined();
        });

        it('rejects array of reward values', () => {
            const parsed = parseFlightSearchParams({
                from: 'SEA',
                to: 'DTW',
                depart: '2026-07-18',
                trip: 'one-way',
                reward: ['true', 'false'],
            }, routes, bookingWindow);

            expect(parsed).toBeUndefined();
        });
    });

    describe('parseFlightSearchUrl', () => {
        it('parses URL string with reward=true', () => {
            const parsed = parseFlightSearchUrl(
                'https://example.com/flights?from=SEA&to=DTW&depart=2026-07-18&trip=one-way&reward=true',
                routes,
                bookingWindow,
            );

            expect(parsed).toEqual({
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY',
                isRewardSearch: true,
            });
        });

        it('parses pathname with query string', () => {
            const parsed = parseFlightSearchUrl(
                '/?from=SEA&to=DTW&depart=2026-07-18&return=2026-07-25&trip=round-trip&cabin=FIRST&reward=true',
                routes,
                bookingWindow,
            );

            expect(parsed).toEqual({
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '2026-07-25',
                tripType: 'round-trip',
                cabinClass: 'FIRST',
                isRewardSearch: true,
            });
        });

        it('strips hash fragments from URL', () => {
            const parsed = parseFlightSearchUrl(
                'https://example.com/flights?from=SEA&to=DTW&depart=2026-07-18&trip=one-way&reward=true#flight-details',
                routes,
                bookingWindow,
            );

            expect(parsed).toEqual({
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY',
                isRewardSearch: true,
            });
        });

        it('treats path without query as having no search parameters even with hash', () => {
            const parsed = parseFlightSearchUrl(
                '/flights#section',
                routes,
                bookingWindow,
            );

            expect(parsed).toBeUndefined();
        });
    });

    describe('isUnusableSearchLink', () => {
        it('identifies link with reward param but missing routes as unusable', () => {
            expect(isUnusableSearchLink({ reward: 'true' }, undefined)).toBe(true);
        });
    });

    describe('round trip serialization', () => {
        it('preserves isRewardSearch through build and parse', () => {
            const original: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-18',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'PREMIUM_ECONOMY',
                isRewardSearch: true,
            };

            const url = buildFlightSearchUrl(original, '/');
            const parsed = parseFlightSearchUrl(url, routes, bookingWindow);

            expect(parsed).toEqual(original);
        });
    });
});
