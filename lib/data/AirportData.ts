export interface AirportRecord {
    /** IATA station code, the stable identifier for the airport. */
    iataCode: string;
    /**
     * How this place is written wherever a person reads or types it: a schedule
     * names a route in these words, and so does a search. Flights reference the
     * code and render this, rather than storing it a second time (#73).
     */
    label: string;
    city: string;
    country: string;
    /** IANA zone, the single source for converting an instant to a local day. */
    timeZone: string;
}

/**
 * Reference data for every place the seeded routes fly between. A route whose
 * origin is missing here cannot resolve its local calendar day, so
 * `__tests__/lib/airports.test.ts` fails the build when the two drift apart.
 *
 * Where a city has several airports, the busiest international one is used.
 */
const AirportData: AirportRecord[] = [
    { iataCode: 'SEA', label: 'Seattle, USA', city: 'Seattle', country: 'United States', timeZone: 'America/Los_Angeles' },
    { iataCode: 'DTW', label: 'Detroit, USA', city: 'Detroit', country: 'United States', timeZone: 'America/Detroit' },
    { iataCode: 'JFK', label: 'New York, USA', city: 'New York', country: 'United States', timeZone: 'America/New_York' },
    { iataCode: 'LHR', label: 'London, UK', city: 'London', country: 'United Kingdom', timeZone: 'Europe/London' },
    { iataCode: 'SFO', label: 'San Francisco, USA', city: 'San Francisco', country: 'United States', timeZone: 'America/Los_Angeles' },
    { iataCode: 'HND', label: 'Tokyo, Japan', city: 'Tokyo', country: 'Japan', timeZone: 'Asia/Tokyo' },
    { iataCode: 'ORD', label: 'Chicago, USA', city: 'Chicago', country: 'United States', timeZone: 'America/Chicago' },
    { iataCode: 'CDG', label: 'Paris, France', city: 'Paris', country: 'France', timeZone: 'Europe/Paris' },
    { iataCode: 'MIA', label: 'Miami, USA', city: 'Miami', country: 'United States', timeZone: 'America/New_York' },
    { iataCode: 'GIG', label: 'Rio de Janeiro, Brazil', city: 'Rio de Janeiro', country: 'Brazil', timeZone: 'America/Sao_Paulo' },
];

export default AirportData;
