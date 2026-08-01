import { prisma } from './prisma';

/**
 * The timezone of an airport as stored in the database.
 *
 * Server-only: this module imports the Prisma client. Booking rules use the
 * synchronous `airportTimeZoneFor` in `lib/airports.ts` instead, so the same
 * lookup runs in the browser and on the server and the two cannot disagree
 * about which dates are valid.
 */
export async function findAirportTimeZone(label: string): Promise<string | null> {
    const airport = await prisma.airport.findUnique({
        where: { label },
        select: { timeZone: true },
    });

    return airport?.timeZone ?? null;
}
