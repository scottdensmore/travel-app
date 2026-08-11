/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute, airportTimeZoneFor } from '@/lib/airports';
import { airportLocalInstant } from '@/lib/flightTime';
import { searchFlightsAction } from '@/app/actions';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

/**
 * A customer searching for a date means that date where they are standing.
 *
 * Once departures became instants (#84) the search window stopped agreeing with
 * them: it still bounded a UTC day, so any flight whose origin-local date
 * differs from its UTC date fell out of the day it was asked for. A 22:00
 * departure from Miami is 02:00Z the next morning, which made every occurrence
 * of that route invisible -- and the "try a nearby date" suggestions are
 * computed in origin-local terms, so each one landed back in the same hole. The
 * route could not be booked at all.
 *
 * These use the two shapes that actually break: an origin far enough west that
 * a late departure rolls into the next UTC day, and one far enough east that an
 * early departure falls into the previous one.
 */
const created = { flightIds: [] as number[] };

afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.$disconnect();
});

async function flightLeaving(from: string, to: string, localDate: string, localTime: string) {
    const zone = airportTimeZoneFor(from)!;
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `DAY-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute(from, to),
            departureDate: airportLocalInstant(localDate, localTime, zone),
            priceCents: 30_000,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

/** The date far enough out to be inside the booking window and stable. */
function localDateInDays(from: string, days: number): string {
    const zone = airportTimeZoneFor(from)!;
    const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(future);
}

describe('searching a day at the origin', () => {
    it('finds a late-evening departure whose UTC date is the next day', async () => {
        // Miami at 22:00 is 02:00Z tomorrow. A UTC-day window missed this on
        // every single occurrence.
        const from = 'Miami, USA';
        const localDate = localDateInDays(from, 30);
        const flight = await flightLeaving(from, 'Rio de Janeiro, Brazil', localDate, '22:00');

        const result = await searchFlightsAction(from, 'Rio de Janeiro, Brazil', localDate);

        expect(result).toHaveProperty('flights');
        const found = (result as { flights: Array<{ id: number }> }).flights;
        expect(found.map(f => f.id)).toContain(flight.id);
    });

    it('does not return it on the UTC date it happens to fall in', async () => {
        // The other half: the flight belongs to the origin's day, and only that
        // one. Without this a fix that simply widened the window would pass.
        const from = 'Miami, USA';
        const localDate = localDateInDays(from, 31);
        const flight = await flightLeaving(from, 'Rio de Janeiro, Brazil', localDate, '22:00');

        const nextDay = new Date(`${localDate}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const result = await searchFlightsAction(
            from, 'Rio de Janeiro, Brazil', nextDay.toISOString().slice(0, 10),
        );

        const found = (result as { flights: Array<{ id: number }> }).flights;
        expect(found.map(f => f.id)).not.toContain(flight.id);
    });

    it('finds an early-morning departure east of UTC', async () => {
        // Tokyo at 08:00 is 23:00Z the previous day, so the mirror of the first
        // case: a UTC-day window would have looked a day late.
        const from = 'Tokyo, Japan';
        const localDate = localDateInDays(from, 30);
        const flight = await flightLeaving(from, 'Seattle, USA', localDate, '08:00');

        const result = await searchFlightsAction(from, 'Seattle, USA', localDate);

        const found = (result as { flights: Array<{ id: number }> }).flights;
        expect(found.map(f => f.id)).toContain(flight.id);
    });
});
