/**
 * Reading a booking's flights through its legs.
 *
 * A booking is its own itinerary (#109), and since #118 it can hold more than
 * one leg. Every read of a booking's flights goes through here so that ordering
 * is applied in one place.
 *
 * The Prisma include has to load the legs and their flights:
 *
 *     include: { legs: { include: { flight: true }, orderBy: { sequence: 'asc' } } }
 */

/** The shape these need, kept structural so callers can pass richer rows. */
export interface BookingLegs<TFlight> {
    legs: Array<{ sequence: number; flight: TFlight | null }>;
}

/**
 * The legs of a booking in itinerary order.
 *
 * Sorted here rather than trusting the query, because a caller that forgets
 * `orderBy` would otherwise render the return leg first.
 */
export function orderedLegs<TLeg extends { sequence: number }>(
    booking: { legs: TLeg[] }
): TLeg[] {
    return [...booking.legs].sort((left, right) => left.sequence - right.sequence);
}

/**
 * The flights of a booking, in leg order. A leg whose flight was not loaded is
 * skipped rather than yielding a hole in the itinerary.
 */
export function bookingFlights<TFlight>(booking: BookingLegs<TFlight>): TFlight[] {
    return orderedLegs(booking)
        .map(({ flight }) => flight)
        .filter((flight): flight is TFlight => flight !== null && flight !== undefined);
}

interface HeldSeat {
    passengerId: string;
    seatNumber: string;
    cabinClass: string;
    /// Set once the seat was let go. Carried through so a reader can tell a
    /// live seat from one somebody else may now hold: the row keeps the real
    /// number either way (#76).
    releasedAt?: Date | string | null;
}

/**
 * Travellers described by where they sit on one particular leg.
 *
 * A traveller belongs to a booking, but a seat belongs to a flight, so any view
 * of a single flight -- a manifest, a seat map -- has to take the seat from that
 * leg's assignment. `Passenger.seatNumber` answers with the outbound seat
 * whichever leg is being looked at, which is wrong for every leg but the first.
 *
 * Reads only the assignment. The fallback to `Passenger.seatNumber` that stood
 * in for bookings taken before #118 is gone: that column describes the outbound
 * leg, so it was the wrong answer for every leg but the first (#137).
 */
export function passengersSeatedOnLeg<TPassenger extends { id: string }>(
    leg: { seatAssignments: HeldSeat[] },
    passengers: TPassenger[]
): Array<TPassenger & { seatNumber: string; releasedAt: Date | string | null; cabinClass: string }> {
    return passengers.map((passenger) => {
        const held = leg.seatAssignments.find((seat) => seat.passengerId === passenger.id);
        return {
            ...passenger,
            // Every traveller holds an assignment on every leg, asserted against
            // the whole table by seatAssignmentCoverage.database.test.ts. A leg
            // with no seat for someone is a defect, not a shape to render.
            // Empty rather than the words "Not assigned": the only reader
            // renders this through `seatLabel`, which says so properly. The
            // string used to be interpolated into "Seat Not assigned" (#229).
            seatNumber: held?.seatNumber ?? '',
            releasedAt: held?.releasedAt ?? null,
            cabinClass: held?.cabinClass ?? 'ECONOMY',
        };
    });
}

/**
 * How a seat reads to the customer.
 *
 * A released seat says so rather than showing a number, because the number is
 * no longer the customer's — somebody else may be sitting in it. It reads the
 * release rather than the seat number: releasing used to overwrite the number
 * with a `CANCELLED-` placeholder, so this had to recognise the placeholder and
 * a real seat number beginning with those letters would have been mistaken for
 * one (#76).
 */
export function seatLabel(
    seat: { seatNumber: string; releasedAt?: Date | string | null } | null | undefined,
): string {
    if (!seat?.seatNumber) return 'No seat assigned';
    // Named, not just numbered. "11A" beside a traveller's name is a seat only
    // if you already know that; a screen reader announced it as a bare
    // parenthetical, and a sighted reader had to infer it too (#229). The admin
    // manifest said "Seat 11A" for a held seat but a bare "Released" for a
    // let-go one; both now read this, so the two surfaces cannot drift.
    return seat.releasedAt ? 'Seat released' : `Seat ${seat.seatNumber}`;
}

const CABIN_NAMES: Record<string, string> = {
    ECONOMY: 'Economy',
    PREMIUM_ECONOMY: 'Premium Economy',
    BUSINESS: 'Business',
    FIRST: 'First Class',
};

/**
 * How a cabin reads to a customer.
 *
 * The enum was printed straight onto the boarding pass, so an e-ticket said
 * `PREMIUM_ECONOMY` — underscore, capitals and all — on the one artefact people
 * keep and show at an airport (#169).
 *
 * An unrecognised value is made readable rather than passed through, so a cabin
 * added to the schema before this map catches up still cannot reach a ticket
 * shouting in snake case. It is only ever a fallback: a real cabin belongs
 * above, where the wording is chosen rather than derived.
 */
export function cabinLabel(cabinClass: string | null | undefined): string {
    if (!cabinClass) return '';
    return CABIN_NAMES[cabinClass] ?? cabinClass
        .toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Names a leg by its direction, wherever one is labelled.
 *
 * "Returning" is only true of the *last* leg of a there-and-back trip, which is
 * all `MAX_ITINERARY_LEGS` permits today. Checkout and the profile each held
 * their own `index === 0 ? 'Departing' : 'Returning'`, which agreed only
 * because of that cap: connecting itineraries (#131) raise it, and the two
 * screens would then have called one flight different things (#160).
 *
 * It lives beside `seatLabel` because both answer the same kind of question:
 * how a piece of an itinerary reads to a customer.
 *
 * This covers the places that *label* a leg. Two seat-validation messages still
 * build their own lowercase "departing"/"returning" inline, because they read as
 * prose in a sentence rather than as a label and cannot take these strings as
 * they stand (#171).
 */
export function legDirectionLabel(legIndex: number, legCount: number): string {
    if (legIndex === 0) return 'Departing';
    if (legIndex === legCount - 1) return 'Returning';
    return `Leg ${legIndex + 1}`;
}

/**
 * The outbound flight, which is what every single-flight view wants today.
 * Null when the booking has no legs, or none whose flight was loaded.
 */
export function outboundFlight<TFlight>(booking: BookingLegs<TFlight>): TFlight | null {
    return bookingFlights(booking)[0] ?? null;
}
