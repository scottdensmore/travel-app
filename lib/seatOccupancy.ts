/**
 * When a seat counts as taken.
 *
 * One rule — a seat is held unless the booking holding it was cancelled — asked
 * by four queries: booking a flight, reading a seat map, changing a seat, and
 * editing a cabin layout. Each wrote the condition out again, so getting it
 * wrong in one place meant a seat that was free on one screen and taken on
 * another.
 *
 * It is stated here because three queued issues rewrite those same call sites
 * independently — inventory holds (#74), payments (#75) and cancellation rules
 * (#76) — and each would otherwise have to find all four and change them the
 * same way (#143).
 *
 * Note what this is *not*: `searchFlightsAction` filters cancelled **flights**
 * out of search results, which reads similarly and is a different question. A
 * cancelled flight is not a released seat.
 */

const HELD_SEAT = {
    releasedAt: null,
} as const;

/**
 * Narrows a seat-assignment query to the seats that are actually held.
 *
 *     where: heldSeats({ flightId })
 *     where: heldSeats({ flightId: { in: ids }, NOT: { leg: { bookingId } } })
 *     where: heldSeats()
 *
 * A function rather than an object to spread, because the rule has to win.
 * Spread beside a caller's conditions it could be erased by one of them: a
 * `releasedAt` key written *before* the spread is a TypeScript error, but the
 * same key written *after* it compiles cleanly and drops the condition from the
 * SQL entirely — no released seats filtered, and nothing to grep for. Applying
 * the rule last means a caller cannot lose it by accident, only by editing this
 * file.
 *
 * The seat row now answers this itself. It used to be a join to the booking's
 * status, because releasing a seat meant renaming it to a
 * `CANCELLED-<passengerId>` placeholder and the row had no way to say it was
 * free; the same partial unique index that lets a released row keep its real
 * seat number is what this filter now agrees with (#76). Agreeing with the
 * index matters: a query that read released seats as occupied would report a
 * seat taken that the database would happily sell.
 */
export function heldSeats<T extends object>(scope: T = {} as T): T & typeof HELD_SEAT {
    return { ...scope, ...HELD_SEAT };
}
