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
        }, '/')).toBe(
            '/?from=Seattle%2C+USA&to=Detroit%2C+USA&trip=round-trip'
        );
    });
});
