/** @jest-environment node */
import {
    REFUND_CUTOFF_HOURS,
    cancellableBooking,
    cancellationNote,
    cancellationOutcome,
} from '@/lib/cancellationPolicy';

/**
 * What a customer gets back, and whether they may cancel at all.
 *
 * The table is #76's decision record, and these are its edges. Two of them are
 * live defects this closes: nothing stopped a customer cancelling a flight that
 * had already departed -- releasing a seat on a flown flight and deducting
 * status points for a trip they took -- and no refund was ever calculated at
 * all.
 *
 * Money is floored in minor units at every step, so the airline never refunds
 * more than it charged. Where that leaves a cent behind, it says so rather than
 * rounding it away invisibly.
 */
const HOUR = 60 * 60 * 1000;
const now = new Date('2026-08-10T12:00:00Z');
const inDays = (days: number) => new Date(now.getTime() + days * 24 * HOUR);
const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR);

const booking = (overrides: {
    totalPriceCents?: number;
    cabins?: Array<'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'>;
    legFareCents?: number[];
    departsAt?: Date;
    status?: 'CONFIRMED' | 'DISRUPTED';
} = {}) => ({
    totalPriceCents: overrides.totalPriceCents ?? 10_000,
    status: overrides.status ?? ('CONFIRMED' as const),
    departsAt: overrides.departsAt ?? inDays(30),
    legFareCents: overrides.legFareCents ?? [10_000],
    cabins: overrides.cabins ?? (['ECONOMY'] as const),
});

describe('whether the booking may be cancelled at all', () => {
    it('refuses once the trip has departed', () => {
        // Not a fee decision, an integrity one: cancelling a flown flight
        // rewrites history, frees a seat that was used, and takes back status
        // points for a trip the customer actually took.
        const outcome = cancellationOutcome(booking({ departsAt: inHours(-1) }), now);

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('ALREADY_DEPARTED');
    });

    it('allows it right up to the moment of departure', () => {
        expect(cancellationOutcome(booking({ departsAt: inHours(1) }), now).allowed).toBe(true);
    });

    it('refuses at exactly the departure time', () => {
        // The boundary belongs on the refusing side: a flight departing this
        // instant has gone.
        expect(cancellationOutcome(booking({ departsAt: now }), now).allowed).toBe(false);
    });
});

describe('what comes back before the cut-off', () => {
    it('refunds a First fare in full', () => {
        const outcome = cancellationOutcome(
            booking({ cabins: ['FIRST'], legFareCents: [10_000], totalPriceCents: 30_000 }),
            now,
        );

        expect(outcome).toMatchObject({ allowed: true, refundCents: 30_000, feeCents: 0 });
    });

    it('refunds a Business fare in full', () => {
        const outcome = cancellationOutcome(
            booking({ cabins: ['BUSINESS'], legFareCents: [10_000], totalPriceCents: 20_000 }),
            now,
        );

        expect(outcome).toMatchObject({ refundCents: 20_000, feeCents: 0 });
    });

    it('keeps a fifth of an Economy fare', () => {
        const outcome = cancellationOutcome(booking({ totalPriceCents: 10_000 }), now);

        expect(outcome).toMatchObject({ refundCents: 8_000, feeCents: 2_000 });
    });

    it('keeps a fifth of a Premium Economy fare', () => {
        const outcome = cancellationOutcome(
            booking({
                cabins: ['PREMIUM_ECONOMY'],
                legFareCents: [10_000],
                totalPriceCents: 15_000,
            }),
            now,
        );

        expect(outcome).toMatchObject({ refundCents: 12_000, feeCents: 3_000 });
    });

    it('charges each traveller by their own cabin on a mixed booking', () => {
        // A Business traveller does not pay an Economy fee because somebody
        // else on the booking flew Economy. The shares come from the same fare
        // model the booking was priced with.
        const outcome = cancellationOutcome(
            booking({
                cabins: ['BUSINESS', 'ECONOMY'],
                legFareCents: [10_000],
                // 200% + 100% of a 10,000 fare.
                totalPriceCents: 30_000,
            }),
            now,
        );

        // Business 20,000 refunded whole; Economy 10,000 less 2,000.
        expect(outcome).toMatchObject({ refundCents: 28_000, feeCents: 2_000 });
    });

    it('floors the fee against the customer, never the airline', () => {
        // 20% of 1 cent is a fifth of a cent. Rounding it up would charge a fee
        // nobody agreed to; rounding down refunds the cent.
        const outcome = cancellationOutcome(booking({ totalPriceCents: 1, legFareCents: [1] }), now);

        expect(outcome).toMatchObject({ refundCents: 1, feeCents: 0 });
    });

    it('never refunds more than was charged', () => {
        // The apportionment floors each share, so the parts can sum to less
        // than the whole -- but never to more.
        const outcome = cancellationOutcome(
            booking({ cabins: ['ECONOMY', 'ECONOMY', 'ECONOMY'], totalPriceCents: 10_001 }),
            now,
        );

        expect(outcome.refundCents + outcome.feeCents).toBeLessThanOrEqual(10_001);
    });
});

describe('what comes back inside the cut-off', () => {
    it('allows the cancellation and refunds nothing', () => {
        // Refusing would strand the customer with a booking they cannot act on
        // and keep a seat held that could still be resold.
        const outcome = cancellationOutcome(
            booking({ departsAt: inHours(REFUND_CUTOFF_HOURS - 1) }),
            now,
        );

        expect(outcome).toMatchObject({ allowed: true, refundCents: 0, reason: 'INSIDE_CUTOFF' });
    });

    it('treats the cut-off itself as still refundable', () => {
        const outcome = cancellationOutcome(
            booking({ departsAt: inHours(REFUND_CUTOFF_HOURS) }),
            now,
        );

        expect(outcome.refundCents).toBe(8_000);
    });

    it('charges no fee for a refund of nothing', () => {
        // The fee is what the airline keeps out of a refund, not a charge it
        // levies: with nothing refunded there is nothing to keep.
        const outcome = cancellationOutcome(booking({ departsAt: inHours(2) }), now);

        expect(outcome).toMatchObject({ refundCents: 0, feeCents: 0 });
    });
});

describe('a booking the airline disrupted', () => {
    it('refunds in full whatever the cabin', () => {
        const outcome = cancellationOutcome(
            booking({ status: 'DISRUPTED', totalPriceCents: 10_000 }),
            now,
        );

        expect(outcome).toMatchObject({ refundCents: 10_000, feeCents: 0, reason: 'DISRUPTED' });
    });

    it('refunds in full inside the cut-off too', () => {
        // The cut-off exists to price the customer's change of mind. This was
        // not one.
        const outcome = cancellationOutcome(
            booking({ status: 'DISRUPTED', departsAt: inHours(2), totalPriceCents: 10_000 }),
            now,
        );

        expect(outcome.refundCents).toBe(10_000);
    });

    it('is still refused once the flight has departed', () => {
        // A flight that departed was not cancelled by the airline, whatever the
        // booking says; this state should not exist, and paying out on it would
        // be worse than refusing.
        const outcome = cancellationOutcome(
            booking({ status: 'DISRUPTED', departsAt: inHours(-1) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
    });
});

describe('reading a loaded booking', () => {
    const leg = (overrides: Partial<{ priceCents: number; departureDate: Date; cabins: string[] }> = {}) => ({
        flight: {
            priceCents: overrides.priceCents ?? 10_000,
            departureDate: overrides.departureDate ?? inDays(30),
        },
        seatAssignments: (overrides.cabins ?? ['ECONOMY']).map(cabinClass => ({ cabinClass })),
    });

    it('takes the departure from the first leg', () => {
        // A trip is past cancelling once it has begun, even with a return leg
        // still to fly.
        const read = cancellableBooking({
            status: 'CONFIRMED',
            totalPriceCents: 20_000,
            legs: [leg({ departureDate: inDays(5) }), leg({ departureDate: inDays(12) })],
        } as never);

        expect(read.departsAt).toEqual(inDays(5));
        expect(read.legFareCents).toEqual([10_000, 10_000]);
    });

    it('falls back to the catalogue fare when no total was stored', () => {
        // The same answer the points deduction in the same action reaches.
        // Reading it as zero refunded nothing while the points came off the
        // real price.
        const read = cancellableBooking({
            status: 'CONFIRMED',
            totalPriceCents: null,
            legs: [leg({ priceCents: 7_500 })],
        } as never);

        expect(read.totalPriceCents).toBe(7_500);
        expect(cancellationOutcome(read, now).refundCents).toBe(6_000);
    });

    it('assumes one Economy traveller when a leg carries no seats', () => {
        // Should not happen -- every traveller holds an assignment per leg --
        // but apportioning by an empty list silently refunds nothing, and the
        // least generous cabin is the safe way to be wrong.
        const read = cancellableBooking({
            status: 'CONFIRMED',
            totalPriceCents: 30_000,
            legs: [leg({ cabins: [] })],
        } as never);

        expect(read.cabins).toEqual(['ECONOMY']);
        expect(cancellationOutcome(read, now)).toMatchObject({ refundCents: 24_000, feeCents: 6_000 });
    });
});

describe('the note written onto the history row', () => {
    it('does not call a refund of nothing a full refund', () => {
        // "No fee" and "refunded in full" are different claims, and the row is
        // the only account of why the amount was what it was.
        const note = cancellationNote({
            allowed: true, reason: 'REFUNDABLE', refundCents: 0, feeCents: 0,
        });

        expect(note).not.toMatch(/in full/i);
        expect(note).toMatch(/no cancellation fee/i);
    });

    it('names the fee that was kept', () => {
        const note = cancellationNote({
            allowed: true, reason: 'REFUNDABLE', refundCents: 8_000, feeCents: 2_000,
        });

        expect(note).toContain('2000');
    });

    it('says why nothing came back inside the cut-off', () => {
        const note = cancellationNote({
            allowed: true, reason: 'INSIDE_CUTOFF', refundCents: 0, feeCents: 0,
        });

        expect(note).toContain(String(REFUND_CUTOFF_HOURS));
    });

    it('records a disruption as the airline\'s doing', () => {
        const note = cancellationNote({
            allowed: true, reason: 'DISRUPTED', refundCents: 10_000, feeCents: 0,
        });

        expect(note).toMatch(/airline/i);
    });
});
