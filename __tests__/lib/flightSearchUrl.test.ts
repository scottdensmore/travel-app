import {
    buildFlightSearchUrl,
    isUnusableSearchLink,
    parseFlightSearchParams,
} from '@/lib/flightSearchUrl';
import { airportCodeFor } from '@/lib/airports';

const routes = [
    { from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' },
    { from: 'New York, USA', to: 'London, UK', nextOperatingDate: '2026-07-18' },
];

const bookingWindow = {
    earliestDate: '2026-07-14',
    latestDate: '2027-07-14',
};

/**
 * The URL names places by IATA code, the form and the results name them in
 * words (#73).
 *
 * A label was free text that was also an identity, which is the confusion the
 * airport references removed from the database. The URL was the last place it
 * survived: `?from=Seattle%2C+USA` meant a link broke the moment a city was
 * renamed, and it encoded prose into something meant to be stable. Codes are
 * the identity; these two functions are where the two representations meet.
 */
describe('the airport codes the URL carries', () => {
    it('writes codes, not the words the form shows', () => {
        const url = buildFlightSearchUrl({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-07-18',
            returnDate: '',
            tripType: 'one-way',
            cabinClass: 'ECONOMY',
        }, '/');

        expect(url).toBe('/?from=SEA&to=DTW&depart=2026-07-18&trip=one-way');
        expect(url).not.toContain('Seattle');
    });

    it('reads a code back as the place the form names', () => {
        expect(parseFlightSearchParams({
            from: 'SEA',
            to: 'DTW',
            depart: '2026-07-18',
            trip: 'one-way',
        }, routes, bookingWindow)).toMatchObject({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
        });
    });

    it('refuses a code no airport answers to', () => {
        expect(parseFlightSearchParams({
            from: 'ZZZ',
            to: 'DTW',
            depart: '2026-07-18',
            trip: 'one-way',
        }, routes, bookingWindow)).toBeUndefined();
    });

    it('refuses a label where a code belongs, rather than quietly accepting both', () => {
        // Two spellings of the same link is how the old format would have
        // survived indefinitely, and every reader would have to handle each.
        expect(parseFlightSearchParams({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            depart: '2026-07-18',
            trip: 'one-way',
        }, routes, bookingWindow)).toBeUndefined();
    });

    it('still refuses a pair of real airports the airline does not fly', () => {
        // The route check survives the change of representation: SEA and LHR
        // both exist, and nothing flies between them.
        expect(parseFlightSearchParams({
            from: 'SEA',
            to: 'LHR',
            depart: '2026-07-18',
            trip: 'one-way',
        }, routes, bookingWindow)).toBeUndefined();
    });
});

describe('the code lookup is exact', () => {
    // A tolerant lookup would be a compatibility shim by the back door: `?from=sea`
    // and `?from=%20SEA` would start working, and two spellings of a link would
    // survive after all (#73).
    it.each(['sea', 'Sea', ' SEA', 'SEA ', 'S E A'])('refuses %p', (code) => {
        expect(parseFlightSearchParams({
            from: code,
            to: 'DTW',
            depart: '2026-07-18',
            trip: 'one-way',
        }, routes, bookingWindow)).toBeUndefined();
    });
});

describe('a place with no airport', () => {
    it('produces a link that cannot be mistaken for a working one', () => {
        // The route list comes from FlightSchedule prose, so in principle it
        // can name somewhere AirportData does not. The URL must not then carry
        // the label as though nothing were wrong -- that is the old format
        // reappearing for exactly the places least able to survive it.
        const url = buildFlightSearchUrl({
            from: 'Atlantis, Nowhere',
            to: 'Detroit, USA',
            departureDate: '2026-07-18',
            returnDate: '',
            tripType: 'one-way',
            cabinClass: 'ECONOMY',
        }, '/');

        expect(url).not.toContain('Atlantis');
        expect(url).toContain('from=&');
        expect(parseFlightSearchParams(
            Object.fromEntries(new URL(url, 'http://x').searchParams),
            routes,
            bookingWindow,
        )).toBeUndefined();
    });
});

describe('every place the form can offer', () => {
    it('resolves to an airport code, so no search can build a broken link', () => {
        // `buildFlightSearchUrl` writes an empty parameter for a place it
        // cannot resolve, which produces a link that looks fine to whoever
        // copies it. That branch is unreachable only while every route
        // endpoint is a known airport -- which is what this asserts, since the
        // routes come from FlightSchedule prose rather than from AirportData.
        for (const route of routes) {
            expect(airportCodeFor(route.from)).not.toBeNull();
            expect(airportCodeFor(route.to)).not.toBeNull();
        }
    });
});

describe('parseFlightSearchParams', () => {
    it('restores valid round-trip criteria', () => {
        expect(parseFlightSearchParams({
            from: 'JFK',
            to: 'LHR',
            depart: '2026-07-18',
            return: '2026-07-25',
            trip: 'round-trip',
        }, routes, bookingWindow)).toEqual({
            from: 'New York, USA',
            to: 'London, UK',
            departureDate: '2026-07-18',
            returnDate: '2026-07-25',
            tripType: 'round-trip',
            cabinClass: 'ECONOMY' as const,
        });
    });

    it.each([
        {
            name: 'an unknown route',
            params: {
                from: 'SEA',
                to: 'LHR',
                depart: '2026-07-18',
                return: '2026-07-25',
                trip: 'round-trip',
            },
        },
        {
            name: 'a departure outside the booking window',
            params: {
                from: 'SEA',
                to: 'DTW',
                depart: '2026-07-13',
                return: '2026-07-20',
                trip: 'round-trip',
            },
        },
        {
            name: 'a return before departure',
            params: {
                from: 'SEA',
                to: 'DTW',
                depart: '2026-07-20',
                return: '2026-07-19',
                trip: 'round-trip',
            },
        },
    ])('rejects $name', ({ params }) => {
        expect(parseFlightSearchParams(params, routes, bookingWindow)).toBeUndefined();
    });

    it('restores a round trip without an optional return date', () => {
        expect(parseFlightSearchParams({
            from: 'SEA',
            to: 'DTW',
            depart: '2026-07-20',
            trip: 'round-trip',
        }, routes, bookingWindow)).toEqual({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-07-20',
            returnDate: '',
            tripType: 'round-trip',
            cabinClass: 'ECONOMY' as const,
        });
    });

    it('restores a route-only search without optional dates', () => {
        expect(parseFlightSearchParams({
            from: 'SEA',
            to: 'DTW',
            trip: 'round-trip',
        }, routes, bookingWindow)).toEqual({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '',
            returnDate: '',
            tripType: 'round-trip',
            cabinClass: 'ECONOMY' as const,
        });
    });
});

describe('buildFlightSearchUrl', () => {
    it('builds a shareable round-trip URL', () => {
        expect(buildFlightSearchUrl({
            from: 'New York, USA',
            to: 'London, UK',
            departureDate: '2026-07-18',
            returnDate: '2026-07-25',
            tripType: 'round-trip',
            cabinClass: 'ECONOMY' as const,
        }, '/')).toBe(
            '/?from=JFK&to=LHR&depart=2026-07-18&return=2026-07-25&trip=round-trip'
        );
    });

    it('omits the return date from a one-way URL', () => {
        expect(buildFlightSearchUrl({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-07-20',
            returnDate: '',
            tripType: 'one-way',
            cabinClass: 'ECONOMY' as const,
        }, '/')).toBe(
            '/?from=SEA&to=DTW&depart=2026-07-20&trip=one-way'
        );
    });

    it('omits empty optional dates from a route-only URL', () => {
        expect(buildFlightSearchUrl({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '',
            returnDate: '',
            tripType: 'round-trip',
            cabinClass: 'ECONOMY' as const,
        }, '/')).toBe(
            '/?from=SEA&to=DTW&trip=round-trip'
        );
    });

    describe('cabin', () => {
        const routes = [{ from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' }];
        const window = { earliestDate: '2026-07-14', latestDate: '2027-07-14' };

        it('keeps economy out of the URL, since it is the default', () => {
            const url = buildFlightSearchUrl({
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-15',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY' as const,
            }, '/');
            expect(url).not.toContain('cabin=');
        });

        it('round-trips a non-default cabin through the URL', () => {
            const criteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-15',
                returnDate: '',
                tripType: 'one-way' as const,
                cabinClass: 'BUSINESS' as const,
            };
            const url = buildFlightSearchUrl(criteria, '/');
            expect(url).toContain('cabin=BUSINESS');

            const params = Object.fromEntries(new URL(url, 'http://x').searchParams);
            expect(parseFlightSearchParams(params, routes, window)).toEqual(criteria);
        });

        it('defaults a link that predates the parameter', () => {
            const parsed = parseFlightSearchParams(
                { from: 'SEA', to: 'DTW', depart: '2026-07-15', trip: 'one-way' },
                routes,
                window,
            );
            expect(parsed?.cabinClass).toBe('ECONOMY');
        });

        it('rejects a cabin it does not sell rather than showing another', () => {
            // Falling back to economy would show a different trip from the one
            // the link described.
            expect(parseFlightSearchParams(
                { from: 'SEA', to: 'DTW', depart: '2026-07-15', trip: 'one-way', cabin: 'SLEEPER' },
                routes,
                window,
            )).toBeUndefined();
            expect(parseFlightSearchParams(
                { from: 'SEA', to: 'DTW', depart: '2026-07-15', trip: 'one-way', cabin: ['BUSINESS', 'FIRST'] },
                routes,
                window,
            )).toBeUndefined();
        });
    });
});

describe('isUnusableSearchLink', () => {
    const criteria = {
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: '2026-07-15',
        returnDate: '',
        tripType: 'one-way' as const,
        cabinClass: 'ECONOMY' as const,
    };

    it('is false for a plain visit, which asked for nothing', () => {
        expect(isUnusableSearchLink({}, undefined)).toBe(false);
    });

    it('is false when the link parsed, however it was written', () => {
        expect(isUnusableSearchLink({ from: 'SEA', to: 'DTW', trip: 'one-way' }, criteria)).toBe(false);
    });

    it('is true when a link named a search and got nothing back', () => {
        expect(isUnusableSearchLink({ from: 'SEA', to: 'DTW', trip: 'one-way' }, undefined)).toBe(true);
    });

    it.each(['from', 'to', 'depart', 'return', 'trip', 'cabin'])(
        'is true for a refused link carrying only %s',
        (name) => {
            // Gating on from/to alone left a link refused for its date or its
            // cabin falling back in silence.
            expect(isUnusableSearchLink({ [name]: 'anything' }, undefined)).toBe(true);
        },
    );

    it('is false for parameters that are nothing to do with a search', () => {
        expect(isUnusableSearchLink({ utm_source: 'newsletter' }, undefined)).toBe(false);
    });
});
