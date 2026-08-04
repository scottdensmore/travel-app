import {
    buildFlightSearchUrl,
    parseFlightSearchParams,
} from '@/lib/flightSearchUrl';

const routes = [
    { from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' },
    { from: 'New York, USA', to: 'London, UK', nextOperatingDate: '2026-07-18' },
];

const bookingWindow = {
    earliestDate: '2026-07-14',
    latestDate: '2027-07-14',
};

describe('parseFlightSearchParams', () => {
    it('restores valid round-trip criteria', () => {
        expect(parseFlightSearchParams({
            from: 'New York, USA',
            to: 'London, UK',
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
                from: 'Seattle, USA',
                to: 'London, UK',
                depart: '2026-07-18',
                return: '2026-07-25',
                trip: 'round-trip',
            },
        },
        {
            name: 'a departure outside the booking window',
            params: {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                depart: '2026-07-13',
                return: '2026-07-20',
                trip: 'round-trip',
            },
        },
        {
            name: 'a return before departure',
            params: {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
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
            from: 'Seattle, USA',
            to: 'Detroit, USA',
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
            from: 'Seattle, USA',
            to: 'Detroit, USA',
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
            '/?from=New+York%2C+USA&to=London%2C+UK&depart=2026-07-18&return=2026-07-25&trip=round-trip'
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
            '/?from=Seattle%2C+USA&to=Detroit%2C+USA&depart=2026-07-20&trip=one-way'
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
            '/?from=Seattle%2C+USA&to=Detroit%2C+USA&trip=round-trip'
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
                { from: 'Seattle, USA', to: 'Detroit, USA', depart: '2026-07-15', trip: 'one-way' },
                routes,
                window,
            );
            expect(parsed?.cabinClass).toBe('ECONOMY');
        });

        it('rejects a cabin it does not sell rather than showing another', () => {
            // Falling back to economy would show a different trip from the one
            // the link described.
            expect(parseFlightSearchParams(
                { from: 'Seattle, USA', to: 'Detroit, USA', depart: '2026-07-15', trip: 'one-way', cabin: 'SLEEPER' },
                routes,
                window,
            )).toBeUndefined();
            expect(parseFlightSearchParams(
                { from: 'Seattle, USA', to: 'Detroit, USA', depart: '2026-07-15', trip: 'one-way', cabin: ['BUSINESS', 'FIRST'] },
                routes,
                window,
            )).toBeUndefined();
        });
    });
});
