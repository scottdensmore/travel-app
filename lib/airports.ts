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

const codesByLabel = new Map(AirportData.map((airport) => [airport.label, airport.iataCode]));

/**
 * The IATA code for the free-text place a route names.
 *
 * A route is authored and searched in words -- a schedule names a place, and so
 * does a search -- while the airport it touches is identified by its code. Every
 * writer of a flight resolves through here, which is what let the flight stop
 * storing the words at all (#73).
 *
 * Null when the label is unknown, which callers must treat as a failure rather
 * than a default: guessing an airport would put a flight somewhere it does not
 * go.
 */
export function airportCodeFor(label: string): string | null {
    return codesByLabel.get(label) ?? null;
}

const labelsByCode = new Map(AirportData.map((airport) => [airport.iataCode, airport.label]));

/**
 * The words for the airport a code identifies.
 *
 * The inverse of `airportCodeFor`, and the reason the search URL can name a
 * place by code while the form and the results name it in words (#73). A label
 * is prose that can be reworded; a code is the thing a link should survive on.
 *
 * Null when no airport carries the code, which a caller reading a URL must
 * treat as an unusable link rather than defaulting to somewhere else.
 */
export function airportLabelFor(iataCode: string): string | null {
    return labelsByCode.get(iataCode) ?? null;
}

/**
 * The pair of airport references a flight on this route needs.
 *
 * Every writer of a flight goes through here so the reference and the label
 * cannot describe different places, and so a route naming somewhere with no
 * airport fails at the point of creation rather than at the constraint -- where
 * the error names a column instead of a place.
 *
 * @throws Error when either end is not a known airport.
 */
export function airportCodesForRoute(from: string, to: string): {
    fromAirportCode: string;
    toAirportCode: string;
} {
    const fromAirportCode = airportCodeFor(from);
    const toAirportCode = airportCodeFor(to);

    const unknown = [...new Set([
        ...(fromAirportCode === null ? [from] : []),
        ...(toAirportCode === null ? [to] : []),
    ])];
    if (unknown.length > 0) {
        throw new Error(`No airport is known for ${unknown.map((place) => JSON.stringify(place)).join(' or ')}.`);
    }

    return { fromAirportCode: fromAirportCode!, toAirportCode: toAirportCode! };
}
