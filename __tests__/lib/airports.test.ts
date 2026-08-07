/** @jest-environment node */
import { FlightData, FlightScheduleData } from '@/lib/data/FlightData';
import AirportData from '@/lib/data/AirportData';
import { airportCodeFor, airportCodesForRoute, airportLocalDate, airportTimeZoneFor } from '@/lib/airports';

describe('airport local date', () => {
    it('resolves the calendar day at the airport, not in UTC', () => {
        // 23:30 UTC is already the next day in Tokyo and still the previous
        // afternoon in Los Angeles.
        const instant = new Date('2026-06-25T23:30:00Z');

        expect(airportLocalDate('Asia/Tokyo', instant)).toBe('2026-06-26');
        expect(airportLocalDate('America/Los_Angeles', instant)).toBe('2026-06-25');
        expect(airportLocalDate('Europe/London', instant)).toBe('2026-06-26');
    });

    it('resolves the previous day for airports behind UTC just after midnight', () => {
        const instant = new Date('2026-06-25T00:30:00Z');

        expect(airportLocalDate('America/New_York', instant)).toBe('2026-06-24');
        expect(airportLocalDate('America/Sao_Paulo', instant)).toBe('2026-06-24');
        expect(airportLocalDate('Asia/Tokyo', instant)).toBe('2026-06-25');
    });

    it('follows daylight saving rather than a fixed offset', () => {
        // 04:30 UTC is 00:30 in New York on EDT and 23:30 the day before on EST.
        expect(airportLocalDate('America/New_York', new Date('2026-07-01T04:30:00Z')))
            .toBe('2026-07-01');
        expect(airportLocalDate('America/New_York', new Date('2026-01-01T04:30:00Z')))
            .toBe('2025-12-31');
    });

    it('rejects a timezone the platform does not recognise', () => {
        expect(() => airportLocalDate('Mars/Olympus', new Date())).toThrow();
    });
});

describe('airport reference data', () => {
    it('covers every place the seeded routes fly between', () => {
        const labels = new Set(AirportData.map(({ label }) => label));
        const places = new Set([
            ...FlightScheduleData.flatMap(({ from, to }) => [from, to]),
            ...FlightData.flatMap(({ from, to }) => [from, to]),
        ]);

        // A route whose origin has no airport cannot resolve a local day.
        expect([...places].filter(place => !labels.has(place))).toEqual([]);
    });

    it('identifies each airport uniquely', () => {
        expect(new Set(AirportData.map(({ iataCode }) => iataCode)).size).toBe(AirportData.length);
        expect(new Set(AirportData.map(({ label }) => label)).size).toBe(AirportData.length);
    });

    it('carries a timezone the platform can resolve', () => {
        for (const { iataCode, timeZone } of AirportData) {
            expect(() => airportLocalDate(timeZone, new Date())).not.toThrow();
            expect(`${iataCode} ${timeZone}`).toMatch(/^[A-Z]{3} [A-Za-z]+\/[A-Za-z_]+$/);
        }
    });
});

describe('airport timezone lookup', () => {
    it('resolves the timezone of a place the routes serve', () => {
        expect(airportTimeZoneFor('Tokyo, Japan')).toBe('Asia/Tokyo');
        expect(airportTimeZoneFor('Seattle, USA')).toBe('America/Los_Angeles');
    });

    it('returns null for a place with no airport, so callers can fall back to UTC', () => {
        expect(airportTimeZoneFor('Atlantis, Nowhere')).toBeNull();
    });

    it('agrees with the reference data the seed writes to the database', () => {
        for (const { label, timeZone } of AirportData) {
            expect(airportTimeZoneFor(label)).toBe(timeZone);
        }
    });
});

describe('airportCodeFor', () => {
    it('resolves the label a route carries to a stable code', () => {
        expect(airportCodeFor('Seattle, USA')).toBe('SEA');
        expect(airportCodeFor('Paris, France')).toBe('CDG');
    });

    it('refuses an unknown place rather than guessing one', () => {
        // A flight put at the wrong airport is worse than a flight that fails
        // to be created.
        expect(airportCodeFor('Atlantis, Nowhere')).toBeNull();
        expect(airportCodeFor('')).toBeNull();
    });

});

describe('airportCodesForRoute', () => {
    it('gives a flight both ends of its route', () => {
        expect(airportCodesForRoute('Seattle, USA', 'Detroit, USA')).toEqual({
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });
    });

    it('refuses rather than writing a flight to nowhere, naming what it could not place', () => {
        expect(() => airportCodesForRoute('Atlantis, Nowhere', 'Detroit, USA'))
            .toThrow('No airport is known for "Atlantis, Nowhere".');
        expect(() => airportCodesForRoute('Seattle, USA', 'El Dorado, Nowhere'))
            .toThrow('No airport is known for "El Dorado, Nowhere".');
    });

    it('names a place once when both ends are the same unknown', () => {
        expect(() => airportCodesForRoute('Nowhere', 'Nowhere'))
            .toThrow('No airport is known for "Nowhere".');
    });
});
