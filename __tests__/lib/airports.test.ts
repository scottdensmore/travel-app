/** @jest-environment node */
import { FlightData, FlightScheduleData } from '@/lib/data/FlightData';
import AirportData from '@/lib/data/AirportData';
import { airportLocalDate } from '@/lib/airports';

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
