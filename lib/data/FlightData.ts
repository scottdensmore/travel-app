// Relative, not the '@/' alias: the seed runs this through ts-node, which does
// not resolve path aliases.
import type { Prisma } from '@prisma/client';
import { BRAND } from '../brand';

export const FlightData = [
    {
        flightNumber: `${BRAND.airlineCode}101`,
        airline: BRAND.name,
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        durationMinutes: 245,
        departureDate: new Date('2026-05-15T08:00:00Z'),
        priceCents: 35000,
        status: 'ON_TIME'
    },
    {
        flightNumber: `${BRAND.airlineCode}202`,
        airline: BRAND.name,
        from: 'New York, USA',
        to: 'London, UK',
        durationMinutes: 420,
        departureDate: new Date('2026-06-10T19:30:00Z'),
        priceCents: 85000,
        status: 'DELAYED'
    },
    {
        flightNumber: `${BRAND.airlineCode}303`,
        airline: BRAND.name,
        from: 'San Francisco, USA',
        to: 'Tokyo, Japan',
        durationMinutes: 680,
        departureDate: new Date('2026-07-05T11:00:00Z'),
        priceCents: 120000,
        status: 'CANCELLED'
    },
    {
        flightNumber: `${BRAND.airlineCode}404`,
        airline: BRAND.name,
        from: 'Chicago, USA',
        to: 'Paris, France',
        durationMinutes: 510,
        departureDate: new Date('2026-08-12T17:45:00Z'),
        priceCents: 95000,
        status: 'ON_TIME'
    },
    {
        flightNumber: `${BRAND.airlineCode}505`,
        airline: BRAND.name,
        from: 'Miami, USA',
        to: 'Rio de Janeiro, Brazil',
        durationMinutes: 525,
        departureDate: new Date('2026-09-18T22:00:00Z'),
        priceCents: 50000,
        status: 'ON_TIME'
    }
    // Checked against what the table accepts, so a status here has to be one
    // the `FlightStatus` enum admits. Without this the literals widen to
    // `string`, and the seed would only fail when Postgres rejected the insert.
    //
    // The airport references are omitted on purpose: they are derived from the
    // labels below by `airportCodesForRoute` when the seed writes, so naming
    // them here would be a second place for a route to disagree with itself.
    // `from`/`to` are how a route is authored here, not columns -- the seed
    // resolves them to airport references (#73). Everything else still has to
    // satisfy what Prisma will accept, which is what caught a bad status.
] satisfies (Omit<Prisma.FlightCreateInput, 'fromAirport' | 'toAirport'> & { from: string; to: string })[];

export const FlightScheduleData = [
    {
        flightNumber: `${BRAND.airlineCode}101`,
        airline: BRAND.name,
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        durationMinutes: 245,
        departureTime: '08:00',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        priceCents: 35000
    },
    {
        flightNumber: `${BRAND.airlineCode}202`,
        airline: BRAND.name,
        from: 'New York, USA',
        to: 'London, UK',
        durationMinutes: 420,
        departureTime: '19:30',
        daysOfWeek: [2, 4, 6], // Tue, Thu, Sat
        priceCents: 85000
    },
    {
        flightNumber: `${BRAND.airlineCode}303`,
        airline: BRAND.name,
        from: 'San Francisco, USA',
        to: 'Tokyo, Japan',
        durationMinutes: 680,
        departureTime: '11:00',
        daysOfWeek: [0, 2, 4], // Sun, Tue, Thu
        priceCents: 120000
    },
    {
        flightNumber: `${BRAND.airlineCode}404`,
        airline: BRAND.name,
        from: 'Chicago, USA',
        to: 'Paris, France',
        durationMinutes: 510,
        departureTime: '17:45',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        priceCents: 95000
    },
    {
        flightNumber: `${BRAND.airlineCode}505`,
        airline: BRAND.name,
        from: 'Miami, USA',
        to: 'Rio de Janeiro, Brazil',
        durationMinutes: 525,
        departureTime: '22:00',
        daysOfWeek: [0, 3, 5], // Sun, Wed, Fri
        priceCents: 50000
    },
    // Return legs. Each mirrors an outbound route in the opposite direction,
    // with its own departure time. This is what a return is: another flight,
    // not a second time on the outbound's row.
    {
        flightNumber: `${BRAND.airlineCode}102`,
        airline: BRAND.name,
        from: 'Detroit, USA',
        to: 'Seattle, USA',
        durationMinutes: 285,
        departureTime: '18:00',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        priceCents: 35000
    },
    {
        flightNumber: `${BRAND.airlineCode}203`,
        airline: BRAND.name,
        from: 'London, UK',
        to: 'New York, USA',
        durationMinutes: 485,
        departureTime: '10:00',
        daysOfWeek: [2, 4, 6], // Tue, Thu, Sat
        priceCents: 85000
    },
    {
        flightNumber: `${BRAND.airlineCode}304`,
        airline: BRAND.name,
        from: 'Tokyo, Japan',
        to: 'San Francisco, USA',
        durationMinutes: 575,
        departureTime: '15:00',
        daysOfWeek: [0, 2, 4], // Sun, Tue, Thu
        priceCents: 120000
    },
    {
        flightNumber: `${BRAND.airlineCode}405`,
        airline: BRAND.name,
        from: 'Paris, France',
        to: 'Chicago, USA',
        durationMinutes: 560,
        departureTime: '09:30',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        priceCents: 95000
    }
];

export default FlightData;
