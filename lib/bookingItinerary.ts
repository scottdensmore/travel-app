/**
 * Reading a booking's flights through its legs.
 *
 * A booking is its own itinerary (#109). Today every booking has one leg, so
 * these return exactly what `booking.flight` used to; they exist so that the
 * read path already goes through the legs when round trips add a second one
 * (#69), rather than being rewritten at that point.
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
 * The flights of a booking, in leg order.
 *
 * Sorted here rather than trusting the query, because a caller that forgets
 * `orderBy` would otherwise get an itinerary in whatever order the database
 * returned. A leg whose flight was not loaded is skipped rather than yielding a
 * hole in the itinerary.
 */
export function bookingFlights<TFlight>(booking: BookingLegs<TFlight>): TFlight[] {
    return [...booking.legs]
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ flight }) => flight)
        .filter((flight): flight is TFlight => flight !== null && flight !== undefined);
}

/**
 * The outbound flight, which is what every single-flight view wants today.
 * Null when the booking has no legs, or none whose flight was loaded.
 */
export function outboundFlight<TFlight>(booking: BookingLegs<TFlight>): TFlight | null {
    return bookingFlights(booking)[0] ?? null;
}
