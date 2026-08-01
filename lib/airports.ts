import { prisma } from './prisma';

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

/**
 * The timezone of the airport a route departs from, or null when the origin has
 * no airport record. Callers fall back to UTC rather than failing a search.
 */
export async function findAirportTimeZone(label: string): Promise<string | null> {
    const airport = await prisma.airport.findUnique({
        where: { label },
        select: { timeZone: true },
    });

    return airport?.timeZone ?? null;
}
