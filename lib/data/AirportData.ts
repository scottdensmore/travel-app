export interface AirportRecord {
    /** IATA station code, the stable identifier for the airport. */
    iataCode: string;
    /**
     * The free-text value `Flight.from` and `Flight.to` carry today. This is a
     * transitional join key: routes will reference airports directly once the
     * domain model in #73 lands.
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
