/** @jest-environment node */
import { CabinClass } from '@prisma/client';
import { CABIN_FARE_PERCENT } from '@/lib/bookingPricing';
import { cabinClassSchema } from '@/lib/validation';
import { cabinLabel } from '@/lib/bookingItinerary';

/**
 * Four independent lists of the same four cabins.
 *
 * The database now says which cabins exist (#73). Three other places still have
 * to agree with it and with each other: what each cabin costs, what the request
 * boundary will accept, and what a customer is shown it called. A fifth cabin
 * added to one of them is a fare of `undefined`, or a booking the database
 * refuses after the customer has chosen a seat.
 *
 * The enum is the source of truth here because it is the one a row cannot get
 * around.
 */
const CABINS = Object.values(CabinClass).sort();

describe('cabin class', () => {
    it('is the four the database admits', () => {
        expect(CABINS).toEqual(['BUSINESS', 'ECONOMY', 'FIRST', 'PREMIUM_ECONOMY']);
    });

    it('prices every cabin the database admits', () => {
        expect(Object.keys(CABIN_FARE_PERCENT).sort()).toEqual(CABINS);

        for (const cabin of CABINS) {
            // A cabin cannot cost less than economy, and economy is the base.
            expect(CABIN_FARE_PERCENT[cabin]).toBeGreaterThanOrEqual(CABIN_FARE_PERCENT.ECONOMY);
        }
    });

    it('accepts exactly those cabins at the request boundary', () => {
        expect([...cabinClassSchema.options].sort()).toEqual(CABINS);

        // The guard that matters: a cabin the database would refuse must not
        // get as far as a seat map or a fare.
        expect(cabinClassSchema.safeParse('STEERAGE').success).toBe(false);
    });

    it('has a chosen name for every one of them, not a derived one', () => {
        // Asserting "no underscore" would pass for any cabin at all:
        // `cabinLabel` falls back to title-casing the enum, so deleting
        // `FIRST: 'First Class'` from its map would quietly print "First" on
        // the boarding pass and still satisfy a shape check. These are the
        // words, spelled out.
        expect(CABINS.map(cabinLabel)).toEqual([
            'Business', 'Economy', 'First Class', 'Premium Economy',
        ]);
    });
});
