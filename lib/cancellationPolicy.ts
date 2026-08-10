import { CABIN_FARE_PERCENT, bookingTotalCents, type CabinClass } from '@/lib/bookingPricing';

/**
 * Whether a booking may be cancelled, and what comes back if it is.
 *
 * The rules are #76's decision record, and they live here rather than in the
 * action because they are the part worth reading, arguing with and testing on
 * their own. Nothing in this file touches the database or the clock: the caller
 * passes both, so every edge is reachable from a test without waiting a day.
 *
 * | Cabin                    | Before the cut-off | Inside it          | Departed |
 * |--------------------------|--------------------|--------------------|----------|
 * | First, Business          | Full refund        | Cancel, no refund  | Refused  |
 * | Premium Economy, Economy | Refund less a fee  | Cancel, no refund  | Refused  |
 * | Any, airline disrupted   | Full refund, no fee, no cut-off        | Refused  |
 *
 * One caveat about the input, which is not this module's to fix. `departsAt`
 * is compared against a real instant, but `Flight.departureDate` is not one:
 * `FlightScheduleService` builds it as the schedule's local wall-clock time
 * labelled UTC, in a column with no timezone, which `lib/dates.ts` says
 * outright. So both boundaries here are wrong by the origin airport's offset --
 * east of UTC a departed flight stays cancellable for the length of that
 * offset, and west of it a cancellation is refused early. Every rule below is
 * exact to the millisecond against the value it is given; the value is what is
 * approximate. Fixing it means giving flights real instants, which is #84.
 */

/** How long before departure a refund stops being available. */
export const REFUND_CUTOFF_HOURS = 24;

/**
 * What the airline keeps, per cabin, as a percentage of that traveller's fare.
 *
 * A percentage rather than a flat amount because `Booking.currency` exists: a
 * flat fee is wrong the moment a booking is not in USD and needs a rate to stay
 * right, while a proportion of the fare needs neither.
 */
export const CANCELLATION_FEE_PERCENT: Record<CabinClass, number> = {
    FIRST: 0,
    BUSINESS: 0,
    PREMIUM_ECONOMY: 20,
    ECONOMY: 20,
};

export type CancellationReason =
    /** The trip has begun; cancelling it would rewrite what happened. */
    | 'ALREADY_DEPARTED'
    /** Refundable, less whatever the cabin's fee comes to. */
    | 'REFUNDABLE'
    /** Cancellable, but too close to departure to be worth anything back. */
    | 'INSIDE_CUTOFF'
    /** The airline caused this, so the fare rules do not apply. */
    | 'DISRUPTED';

export interface CancellationOutcome {
    allowed: boolean;
    reason: CancellationReason;
    /** What the customer gets back, in minor units. Zero when nothing does. */
    refundCents: number;
    /** What the airline keeps out of that refund. Never a charge on its own. */
    feeCents: number;
}

/** The booking, as much of it as the policy needs to see. */
export interface CancellableBooking {
    status: 'CONFIRMED' | 'DISRUPTED' | string;
    /** What was actually charged, in minor units. */
    totalPriceCents: number;
    /** When the trip begins -- the first leg's departure. */
    departsAt: Date;
    /** Each leg's catalogue fare, in itinerary order. */
    legFareCents: number[];
    /** One cabin per traveller on the booking. */
    cabins: readonly CabinClass[];
}

/**
 * Each traveller's slice of what was charged, in minor units.
 *
 * A booking can hold different cabins, and a Business traveller should not pay
 * an Economy fee because somebody else on the booking flew Economy. The shares
 * come from the same fare model the booking was priced with, then are scaled to
 * what was *actually* charged -- the two can differ for a booking taken before
 * the total was stored, and the amount charged is the one that may be refunded.
 *
 * Floored, so the shares can sum to slightly less than the total but never to
 * more. The remainder is not refunded; refunding it would mean paying out more
 * than one of these travellers was charged.
 */
function chargedShares(booking: CancellableBooking): number[] {
    const legTotal = booking.legFareCents.reduce((total, fare) => total + fare, 0);
    const modelled = booking.cabins.map(
        cabin => Math.round(legTotal * CABIN_FARE_PERCENT[cabin] / 100),
    );
    const modelledTotal = modelled.reduce((total, share) => total + share, 0);

    if (modelledTotal <= 0) {
        // Nothing to apportion by, so split what was charged evenly rather than
        // dividing by zero. A zero-fare booking lands here and refunds zero.
        const even = Math.floor(booking.totalPriceCents / Math.max(booking.cabins.length, 1));
        return booking.cabins.map(() => even);
    }

    return modelled.map(
        share => Math.floor(booking.totalPriceCents * share / modelledTotal),
    );
}

function hoursUntil(departsAt: Date, now: Date): number {
    return (departsAt.getTime() - now.getTime()) / (60 * 60 * 1000);
}

/**
 * Why the refund came to what it did, in one line, for the history row.
 *
 * Recorded because the amount alone does not survive the rules changing: a
 * refund of zero next year has to be readable as "cancelled inside the 24-hour
 * cut-off" rather than re-derived from whatever the policy says by then.
 */
export function cancellationNote(outcome: CancellationOutcome): string {
    switch (outcome.reason) {
        case 'DISRUPTED':
            return 'Cancelled after the airline disrupted the flight; refunded in full.';
        case 'INSIDE_CUTOFF':
            return `Cancelled within ${REFUND_CUTOFF_HOURS} hours of departure; no refund due.`;
        case 'REFUNDABLE':
            // On the fee, not on the refund: "no fee" and "refunded in full"
            // are different claims, and a booking that refunds nothing without
            // charging a fee would otherwise be recorded as refunded in full.
            return outcome.feeCents === 0
                ? 'Cancelled before the refund cut-off; no cancellation fee applied.'
                : `Cancelled before the refund cut-off; ${outcome.feeCents} minor units of the booking currency retained as the cancellation fee.`;
        default:
            return 'Cancelled.';
    }
}

/**
 * A loaded booking, as the policy needs to see it.
 *
 * Kept beside the rules rather than in the action so that what the policy reads
 * is stated once. The legs must be in itinerary order and carry their flight
 * and their seat assignments' cabins.
 *
 * "Departure" is the *first* leg's, so a trip is past cancelling once it has
 * begun, even with a return leg still to fly. Refunding half a flown itinerary
 * is a different feature, and the decision record does not have one.
 */
export function cancellableBooking(booking: {
    status: string;
    totalPriceCents: number | null;
    legs: Array<{
        flight: { priceCents: number; departureDate: Date } | null;
        seatAssignments: Array<{ cabinClass: CabinClass }>;
    }>;
}): CancellableBooking {
    const flownLegs = booking.legs.filter(leg => leg.flight !== null);
    const departsAt = flownLegs[0]?.flight?.departureDate ?? new Date(0);

    // One cabin per traveller, taken from the first leg: a traveller holds the
    // same cabin across an itinerary, and the fee is per traveller rather than
    // per seat.
    //
    // A leg with no assignments at all should not exist -- every traveller
    // holds one per leg -- but a booking repaired by some other path could
    // reach here, and apportioning by an empty list would silently refund
    // nothing. One Economy traveller is the same fallback the manifest and the
    // itinerary readers already make, and it is the least generous reading, so
    // a wrong guess errs towards the airline rather than towards paying out.
    const seated = flownLegs[0]?.seatAssignments ?? [];
    const cabins: CabinClass[] = seated.length > 0
        ? seated.map(seat => seat.cabinClass)
        : ['ECONOMY'];

    return {
        status: booking.status,
        // The same answer the points deduction in the same action reaches. A
        // booking taken before the total was stored falls back to the flight's
        // catalogue fare; reading it as zero here would refund nothing while
        // the points came off the real price (#76).
        totalPriceCents: bookingTotalCents(booking, flownLegs[0]?.flight ?? null),
        departsAt,
        legFareCents: flownLegs.map(leg => leg.flight!.priceCents),
        cabins,
    };
}

/**
 * Decided from a read taken before the booking is locked.
 *
 * Nothing that reaches this can change underneath it today: no code path
 * rewrites `Flight.departureDate` or `Booking.totalPriceCents` after creation,
 * and nothing writes `DISRUPTED` at all. That stops being true the moment a
 * reschedule or the disruption writer lands -- a booking disrupted between this
 * read and the lock would be charged the fee it should be exempt from -- so
 * whichever slice adds a writer has to re-run the policy under the flight
 * locks, not just here (#76).
 */
export function cancellationOutcome(
    booking: CancellableBooking,
    now: Date,
): CancellationOutcome {
    const hours = hoursUntil(booking.departsAt, now);

    // Checked before anything about money, and before the disruption case: a
    // flight that has gone was not cancelled by the airline, whatever the
    // booking says, and paying out on that state would be worse than refusing.
    if (hours <= 0) {
        return { allowed: false, reason: 'ALREADY_DEPARTED', refundCents: 0, feeCents: 0 };
    }

    if (booking.status === 'DISRUPTED') {
        // The cut-off prices a customer's change of mind. This was not one.
        return {
            allowed: true,
            reason: 'DISRUPTED',
            refundCents: booking.totalPriceCents,
            feeCents: 0,
        };
    }

    if (hours < REFUND_CUTOFF_HOURS) {
        // Still cancellable. Refusing would strand the customer with a booking
        // they cannot act on and keep a seat held that could still be resold.
        return { allowed: true, reason: 'INSIDE_CUTOFF', refundCents: 0, feeCents: 0 };
    }

    const fees = chargedShares(booking).map((share, index) => ({
        share,
        fee: Math.floor(share * CANCELLATION_FEE_PERCENT[booking.cabins[index]] / 100),
    }));

    return {
        allowed: true,
        reason: 'REFUNDABLE',
        refundCents: fees.reduce((total, { share, fee }) => total + share - fee, 0),
        feeCents: fees.reduce((total, { fee }) => total + fee, 0),
    };
}
