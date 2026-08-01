import AirportData from './data/AirportData';

/**
 * The calendar day at an airport for a given instant.
 *
 * Booking rules such as "not in the past" and "within 365 days" are calendar
 * questions, and a calendar day only exists relative to a place. Comparing
 * against the UTC day offers a traveller in Tokyo the wrong earliest date for
 * most of their evening, and a traveller in Los Angeles the wrong one for most
 * of their afternoon.
 *
 * Instant comparisons — whether a departure has already happened — stay on the
 * UTC instant and must not use this.
 *
 * @throws RangeError when the platform does not recognise the zone.
 */
export function airportLocalDate(timeZone: string, instant: Date = new Date()): string {
    // en-CA formats as YYYY-MM-DD, which is the ISO date shape used throughout.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

const timeZonesByLabel = new Map(AirportData.map(({ label, timeZone }) => [label, timeZone]));

/**
 * The timezone of a place, or null when it has no airport record.
 *
 * Deliberately synchronous and backed by compiled reference data rather than
 * the database, for two reasons: booking rules are validated inside a
 * synchronous Zod refinement, and the browser has to reach the same answer as
 * the server. The seed writes this same data into the `Airport` table, so the
 * two cannot drift.
 *
 * Callers fall back to UTC on null rather than failing a customer search.
 */
export function airportTimeZoneFor(label: string): string | null {
    return timeZonesByLabel.get(label) ?? null;
}
