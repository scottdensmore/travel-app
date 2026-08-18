/** @jest-environment node */
import {
    CHECK_IN_CLOSES_MINUTES,
    CHECK_IN_OPENS_HOURS,
    checkInEligibility,
    checkInNextStep,
    legCheckInEligibility,
} from '@/lib/checkInPolicy';

/**
 * Whether a traveller may check in for one leg, and what they are told when
 * they may not.
 *
 * The window is #77's decision record. Nothing here touches the database or the
 * clock -- the caller passes both -- so every edge is reachable without waiting
 * a day, exactly as `cancellationPolicy` is arranged.
 *
 * Check-in is decided per *leg*, not per booking. A round trip's return opens a
 * day before the return flight, which is typically long after the outbound has
 * flown, so a booking-level answer would be wrong for one of the two legs
 * whichever way it were derived.
 */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const now = new Date('2026-08-18T12:00:00Z');
const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR);
const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * MINUTE);

const leg = (overrides: {
    departsAt?: Date;
    flightStatus?: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    bookingStatus?: string;
    checkedIn?: boolean;
} = {}) => ({
    departsAt: overrides.departsAt ?? inHours(5),
    flightStatus: overrides.flightStatus ?? ('ON_TIME' as const),
    bookingStatus: overrides.bookingStatus ?? 'CONFIRMED',
    checkedIn: overrides.checkedIn ?? false,
});

describe('the window itself', () => {
    it('opens a fixed number of hours before departure and closes before it', () => {
        const departsAt = inHours(100);
        const { opensAt, closesAt } = checkInEligibility(leg({ departsAt }), now);

        expect(opensAt.getTime()).toBe(departsAt.getTime() - CHECK_IN_OPENS_HOURS * HOUR);
        expect(closesAt.getTime()).toBe(departsAt.getTime() - CHECK_IN_CLOSES_MINUTES * MINUTE);
        // A window whose ends crossed would refuse every traveller while still
        // reading like a policy.
        expect(opensAt.getTime()).toBeLessThan(closesAt.getTime());
    });

    it('is open between the two, and says so', () => {
        const outcome = checkInEligibility(leg({ departsAt: inHours(5) }), now);

        expect(outcome.allowed).toBe(true);
        expect(outcome.reason).toBe('OPEN');
    });

    it('refuses before it opens', () => {
        const outcome = checkInEligibility(
            leg({ departsAt: inHours(CHECK_IN_OPENS_HOURS + 1) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('NOT_YET_OPEN');
    });

    it('opens exactly on the boundary rather than a moment after', () => {
        // The boundary is the whole rule. Comparing the wrong way round leaves a
        // traveller refused at the instant the policy says they are eligible.
        const outcome = checkInEligibility(
            leg({ departsAt: inHours(CHECK_IN_OPENS_HOURS) }),
            now,
        );

        expect(outcome.reason).toBe('OPEN');
    });

    it('refuses once the desk has closed, while the flight is still on the ground', () => {
        const outcome = checkInEligibility(
            leg({ departsAt: inMinutes(CHECK_IN_CLOSES_MINUTES - 1) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
        // Not DEPARTED: the flight has not left, and telling a customer standing
        // in the terminal that it has is a different and wronger answer.
        expect(outcome.reason).toBe('CLOSED');
    });

    it('closes exactly on the boundary', () => {
        const outcome = checkInEligibility(
            leg({ departsAt: inMinutes(CHECK_IN_CLOSES_MINUTES) }),
            now,
        );

        expect(outcome.reason).toBe('CLOSED');
    });

    it('reports a departed flight as departed, not merely closed', () => {
        const outcome = checkInEligibility(leg({ departsAt: inHours(-1) }), now);

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('DEPARTED');
    });
});

describe('states that outrank the clock', () => {
    it('refuses a cancelled booking however far off the flight is', () => {
        const outcome = checkInEligibility(
            leg({ bookingStatus: 'CANCELLED', departsAt: inHours(5) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('BOOKING_CANCELLED');
    });

    it('refuses a disrupted booking, which needs rebooking before check-in', () => {
        const outcome = checkInEligibility(
            leg({ bookingStatus: 'DISRUPTED', departsAt: inHours(5) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('BOOKING_DISRUPTED');
    });

    it('refuses a cancelled flight inside an otherwise open window', () => {
        const outcome = checkInEligibility(
            leg({ flightStatus: 'CANCELLED', departsAt: inHours(5) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('FLIGHT_CANCELLED');
    });

    it('prefers the booking cancellation to the flight cancellation', () => {
        // Both are true of the same leg after the airline cancels a flight and
        // the customer takes the refund. The booking is the one the customer
        // acted on, and the one whose next step is not "we will rebook you".
        const outcome = checkInEligibility(
            leg({ bookingStatus: 'CANCELLED', flightStatus: 'CANCELLED' }),
            now,
        );

        expect(outcome.reason).toBe('BOOKING_CANCELLED');
    });

    it('checks a delayed flight in on its scheduled window', () => {
        const outcome = checkInEligibility(
            leg({ flightStatus: 'DELAYED', departsAt: inHours(5) }),
            now,
        );

        expect(outcome.allowed).toBe(true);
        expect(outcome.reason).toBe('OPEN');
    });

    it('never calls a delayed flight departed, whatever the clock says', () => {
        // `Flight.departureDate` is the *scheduled* instant and a delay does not
        // move it, so the clock passing it proves nothing about a delayed
        // flight -- the same reason `flightPhaseAt` refuses to advance one.
        const outcome = checkInEligibility(
            leg({ flightStatus: 'DELAYED', departsAt: inHours(-3) }),
            now,
        );

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('CLOSED');
    });

    it('reports an already checked-in traveller as checked in', () => {
        const outcome = checkInEligibility(
            leg({ checkedIn: true, departsAt: inHours(5) }),
            now,
        );

        // Not allowed, because there is nothing left to do -- but not a refusal
        // either, and the page must be able to tell those apart.
        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('ALREADY_CHECKED_IN');
    });

    it('still reports a checked-in traveller once the flight has departed', () => {
        const outcome = checkInEligibility(
            leg({ checkedIn: true, departsAt: inHours(-1) }),
            now,
        );

        expect(outcome.reason).toBe('ALREADY_CHECKED_IN');
    });
});

describe('what the customer is told to do next', () => {
    it('gives every reason a next step', () => {
        const reasons = [
            'OPEN',
            'NOT_YET_OPEN',
            'CLOSED',
            'DEPARTED',
            'FLIGHT_CANCELLED',
            'BOOKING_CANCELLED',
            'BOOKING_DISRUPTED',
            'ALREADY_CHECKED_IN',
            'NOT_TRAVELLING',
        ] as const;

        for (const reason of reasons) {
            const step = checkInNextStep(reason);
            // A refusal with no next step is the defect #77's acceptance
            // criteria name, so an empty string is a failure rather than a gap.
            expect(step.length).toBeGreaterThan(0);
        }
    });

    it('sends a disrupted booking to the rebooking it actually needs', () => {
        expect(checkInNextStep('BOOKING_DISRUPTED')).toContain('rebook');
    });

    it('does not print an enum at a customer', () => {
        // The e-ticket shipped `PREMIUM_ECONOMY` to customers once (#169).
        for (const step of [
            checkInNextStep('NOT_YET_OPEN'),
            checkInNextStep('BOOKING_CANCELLED'),
            checkInNextStep('FLIGHT_CANCELLED'),
        ]) {
            expect(step).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
        }
    });
});

/**
 * The whole leg, which is what the page renders and the action acts on.
 *
 * A booking is checked in a leg at a time for every traveller on it, so the
 * answer has to come from all of their seats rather than from one. The interest
 * is entirely in the aggregation: a party is not checked in because somebody in
 * it is, and a seat somebody let go says nothing about the travellers still on
 * the flight.
 */
describe('a leg, for everyone travelling on it', () => {
    const seat = (overrides: {
        releasedAt?: Date | null;
        checkedInAt?: Date | null;
    } = {}) => ({
        releasedAt: overrides.releasedAt ?? null,
        checkedInAt: overrides.checkedInAt ?? null,
    });

    const legWith = (seats: Array<{ releasedAt: Date | null; checkedInAt: Date | null }>) => ({
        departsAt: inHours(5),
        flightStatus: 'ON_TIME' as const,
        bookingStatus: 'CONFIRMED',
        seats,
    });

    it('is open while any traveller still has to check in', () => {
        const outcome = legCheckInEligibility(
            legWith([seat({ checkedInAt: inHours(-1) }), seat()]),
            now,
        );

        // The party is not done because one of them is. Reporting this leg as
        // checked in would leave the second traveller with no way to do it.
        expect(outcome.allowed).toBe(true);
        expect(outcome.reason).toBe('OPEN');
    });

    it('is checked in only once every travelling seat is', () => {
        const outcome = legCheckInEligibility(
            legWith([seat({ checkedInAt: inHours(-1) }), seat({ checkedInAt: inHours(-1) })]),
            now,
        );

        expect(outcome.reason).toBe('ALREADY_CHECKED_IN');
    });

    it('ignores a released seat when deciding whether the party is done', () => {
        // The traveller who let this seat go is not flying. Counting them would
        // hold the rest of the party out of check-in indefinitely.
        const outcome = legCheckInEligibility(
            legWith([
                seat({ checkedInAt: inHours(-1) }),
                seat({ releasedAt: inHours(-2) }),
            ]),
            now,
        );

        expect(outcome.reason).toBe('ALREADY_CHECKED_IN');
    });

    it('does not report a leg nobody is travelling on as checked in', () => {
        // Every seat released -- a cancelled booking's leg reached another way.
        // "Checked in" would be a claim about nobody, and it reads as done.
        const outcome = legCheckInEligibility(
            legWith([seat({ releasedAt: inHours(-2) })]),
            now,
        );

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).not.toBe('ALREADY_CHECKED_IN');
    });

    it('still refuses a cancelled booking whose travellers checked in first', () => {
        const outcome = legCheckInEligibility(
            {
                ...legWith([seat({ checkedInAt: inHours(-1) })]),
                bookingStatus: 'CANCELLED',
            },
            now,
        );

        expect(outcome.reason).toBe('BOOKING_CANCELLED');
    });

    it('reports how many of the party are still to check in', () => {
        const outcome = legCheckInEligibility(
            legWith([seat(), seat({ checkedInAt: inHours(-1) }), seat({ releasedAt: inHours(-2) })]),
            now,
        );

        // Two travelling, one of them done. A count taken from every row would
        // say three and include somebody who is not on the flight.
        expect(outcome.travelling).toBe(2);
        expect(outcome.awaiting).toBe(1);
    });
});
