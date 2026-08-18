/**
 * Whether a traveller may check in for one leg, and what to tell them when not.
 *
 * The window is #77's decision record, and it lives here rather than in the
 * action because it is the part worth reading, arguing with and testing on its
 * own. Nothing in this file touches the database or the clock: the caller passes
 * both, so every edge is reachable from a test without waiting a day. That is
 * the arrangement `cancellationPolicy` already uses, for the same reasons.
 *
 * | State                    | Check-in                                |
 * |--------------------------|-----------------------------------------|
 * | Booking cancelled        | Refused -- there is no trip to check in |
 * | Booking disrupted        | Refused until the legs are rebooked     |
 * | Flight cancelled         | Refused -- the airline will rebook      |
 * | Already checked in       | Nothing left to do                      |
 * | More than 24h to go      | Refused, with the opening time          |
 * | 24h to 60m before        | Open                                    |
 * | Inside 60m, still ground | Closed                                  |
 * | Departed                 | Refused                                 |
 *
 * Decided per **leg**, never per booking. A round trip's return opens a day
 * before the return flight, long after the outbound has flown, so one answer
 * for the whole booking is wrong for one of the two legs whichever way it is
 * derived -- the same mistake `Passenger.seatNumber` made about seats (#137).
 *
 * `departsAt` is compared against a real instant, and since #84 it is one:
 * `Flight.departureDate` is built from the schedule's local time and the origin
 * airport's zone rather than being that local time labelled UTC. Rendering it is
 * `lib/flightTime`'s job, not this file's -- a window boundary is an instant
 * here and gains a timezone only where it is shown.
 */

/** How long before departure check-in opens. */
export const CHECK_IN_OPENS_HOURS = 24;

/**
 * How long before departure it closes.
 *
 * The desk needs the hour to close the flight; a traveller admitted at the gate
 * with minutes to go is a decision for a human at an airport, not for this.
 */
export const CHECK_IN_CLOSES_MINUTES = 60;

export type CheckInReason =
    /** Inside the window, with the seat still to confirm. */
    | 'OPEN'
    /** The window has not opened yet; `opensAt` says when it does. */
    | 'NOT_YET_OPEN'
    /** Too close to departure, but the flight has not left. */
    | 'CLOSED'
    /** The flight has gone. */
    | 'DEPARTED'
    /** The airline cancelled the flight. */
    | 'FLIGHT_CANCELLED'
    /** The booking is no longer live, so there is no trip to check in for. */
    | 'BOOKING_CANCELLED'
    /** The itinerary needs replacing before any of it can be checked in. */
    | 'BOOKING_DISRUPTED'
    /** Done already. Not a refusal, and the difference is worth showing. */
    | 'ALREADY_CHECKED_IN'
    /**
     * Nobody on this leg holds a seat any more. A leg reaching this on a live
     * booking is a defect rather than a state to offer check-in for, and saying
     * "checked in" about nobody would read as done.
     */
    | 'NOT_TRAVELLING';

/** One traveller on one leg, as much of it as the policy needs to see. */
export interface CheckInLeg {
    /** When the leg leaves, as an instant. */
    departsAt: Date;
    flightStatus: 'ON_TIME' | 'DELAYED' | 'CANCELLED' | string;
    bookingStatus: string;
    /**
     * Whether this leg is already checked in.
     *
     * A boolean rather than the instant, deliberately. Nothing here reports when
     * a check-in happened -- the eligibility answer has no field for it -- so an
     * instant would be a value no reader could observe and every reader could
     * come to depend on. `legCheckInEligibility` folds a whole party's stamps
     * into this, and there is no single honest instant to fold them to.
     */
    checkedIn?: boolean;
}

export interface CheckInEligibility {
    allowed: boolean;
    reason: CheckInReason;
    /** When check-in opens for this leg. Stated even when it is already past. */
    opensAt: Date;
    /** When it closes. */
    closesAt: Date;
}

/**
 * Decided from a read taken before the booking is locked.
 *
 * Nothing that reaches this changes underneath it today, but a reschedule would
 * move `departsAt` and the disruption writer moves `bookingStatus`, so the
 * action re-runs this under the same transaction that records the check-in
 * rather than trusting the answer a page rendered.
 */
export function checkInEligibility(leg: CheckInLeg, now: Date): CheckInEligibility {
    const departsAt = leg.departsAt.getTime();
    const window = {
        opensAt: new Date(departsAt - CHECK_IN_OPENS_HOURS * 60 * 60 * 1000),
        closesAt: new Date(departsAt - CHECK_IN_CLOSES_MINUTES * 60 * 1000),
    };
    const refuse = (reason: CheckInReason) => ({ allowed: false, reason, ...window });

    // The booking outranks everything, including the flight's own cancellation:
    // both are true of the same leg once the airline cancels and the customer
    // takes the refund, and the booking is the state the customer acted on. Its
    // next step is not "we will rebook you".
    if (leg.bookingStatus === 'CANCELLED') return refuse('BOOKING_CANCELLED');
    if (leg.bookingStatus === 'DISRUPTED') return refuse('BOOKING_DISRUPTED');

    // Before the clock, so that a traveller who has checked in is told so rather
    // than told the desk has closed -- true of every checked-in traveller within
    // the hour before departure, which is most of them.
    if (leg.checkedIn) return refuse('ALREADY_CHECKED_IN');

    if (leg.flightStatus === 'CANCELLED') return refuse('FLIGHT_CANCELLED');

    // A delay does not move `Flight.departureDate` -- it is the *scheduled*
    // instant, and airline-set status is a fact the clock does not overwrite
    // (the same reason `flightPhaseAt` never advances a delayed flight). So the
    // clock passing that instant proves nothing about a delayed flight, and
    // calling it departed would tell a customer waiting at the gate that their
    // flight had left. The desk is shut either way, which is true of both.
    if (now.getTime() >= departsAt && leg.flightStatus !== 'DELAYED') {
        return refuse('DEPARTED');
    }

    if (now.getTime() >= window.closesAt.getTime()) return refuse('CLOSED');
    if (now.getTime() < window.opensAt.getTime()) return refuse('NOT_YET_OPEN');

    return { allowed: true, reason: 'OPEN', ...window };
}

/**
 * What the customer does about it.
 *
 * #77's acceptance criteria ask that an ineligible customer get "a clear reason
 * and next step", so every reason has one and the test asserts none is empty. A
 * refusal that only says no is the defect, not the wording.
 */
export function checkInNextStep(reason: CheckInReason): string {
    switch (reason) {
        case 'OPEN':
            return 'Confirm your seat to check in for this flight.';
        case 'NOT_YET_OPEN':
            return `Check-in opens ${CHECK_IN_OPENS_HOURS} hours before departure. Come back then, or set a reminder.`;
        case 'CLOSED':
            return `Online check-in closed ${CHECK_IN_CLOSES_MINUTES} minutes before departure. Speak to an agent at the airport.`;
        case 'DEPARTED':
            return 'This flight has departed. Your other flights, if any, are listed above.';
        case 'FLIGHT_CANCELLED':
            return 'The airline cancelled this flight. Choose a replacement from your profile, or ask an agent to rebook you.';
        case 'BOOKING_CANCELLED':
            return 'This booking was cancelled, so there is nothing to check in for. Book again to travel.';
        case 'BOOKING_DISRUPTED':
            return 'Your flights changed. Choose replacement flights in your profile to rebook, then check in.';
        case 'ALREADY_CHECKED_IN':
            return 'You are checked in. Bring photo identification to the airport.';
        case 'NOT_TRAVELLING':
            return 'No traveller on this booking holds a seat on this flight. Contact us so we can look into it.';
    }
}

/** One leg of a booking, with every traveller's seat on it. */
export interface CheckInLegParty {
    departsAt: Date;
    flightStatus: 'ON_TIME' | 'DELAYED' | 'CANCELLED' | string;
    bookingStatus: string;
    /** One row per traveller on this leg, released ones included. */
    seats: Array<{
        releasedAt?: Date | string | null;
        checkedInAt?: Date | string | null;
    }>;
}

export interface CheckInLegEligibility extends CheckInEligibility {
    /** How many travellers still hold a seat on this leg. */
    travelling: number;
    /** How many of those have yet to check in. */
    awaiting: number;
}

/**
 * The leg as a whole, which is what the page renders and the action acts on.
 *
 * A booking is checked in one leg at a time for everybody travelling on it, so
 * the answer comes from all of their seats. Two aggregations matter and both
 * have a wrong version that looks right:
 *
 *   * the party is checked in only when *every* travelling seat is, not when
 *     any is -- otherwise the second traveller on a booking loses the only
 *     control that would check them in;
 *   * a released seat is not counted at all. Its holder is not on the flight,
 *     and counting them would hold the rest of the party out of check-in for
 *     good.
 */
export function legCheckInEligibility(
    leg: CheckInLegParty,
    now: Date,
): CheckInLegEligibility {
    const travelling = leg.seats.filter(seat => !seat.releasedAt);
    const awaiting = travelling.filter(seat => !seat.checkedInAt);
    const counts = { travelling: travelling.length, awaiting: awaiting.length };

    // Everyone's state, folded into the one question the window rules ask. False
    // while anyone is still to check in, which is what keeps the leg open for
    // them. A boolean because that is all the policy reads: folding the party to
    // one traveller's *instant* meant picking an arbitrary one, which no test
    // could distinguish and any later reader could be misled by.
    const partyCheckedIn = travelling.length > 0 && awaiting.length === 0;

    const outcome = checkInEligibility({ ...leg, checkedIn: partyCheckedIn }, now);

    // After the policy, not before: a cancelled or disrupted booking is the more
    // useful thing to say about a leg whose seats are all released, and it is
    // the ordinary way one gets that way.
    if (travelling.length === 0 && outcome.allowed) {
        return { ...outcome, allowed: false, reason: 'NOT_TRAVELLING', ...counts };
    }

    return { ...outcome, ...counts };
}
