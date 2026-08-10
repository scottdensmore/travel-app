import type { BookingStatus } from '@prisma/client';

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

/**
 * The status a booking carries once it is cancelled.
 *
 * This literal was the whole definition of the domain until #76 typed the
 * column; it now names a value the database enforces, which is what makes the
 * filter below trustworthy rather than hopeful.
 *
 * `DISRUPTED` is deliberately not included. A booking on a flight the airline
 * cancelled keeps its seat until the customer chooses a refund or a rebooking,
 * so it is still held.
 */
export const CANCELLED_BOOKING: BookingStatus = 'CANCELLED';

const HELD_SEAT = {
    leg: { booking: { status: { not: CANCELLED_BOOKING } } },
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
 * `leg` key written *before* the spread is a TypeScript error, but the same key
 * written *after* it compiles cleanly and removes the booking join from the SQL
 * entirely — no cancelled bookings filtered, and nothing to grep for. Applying
 * the rule last means a caller cannot lose it by accident, only by editing this
 * file.
 *
 * What a cancellation does to a seat is worth being precise about, because it
 * decides which call sites this matters at. Cancelling renames the seat to a
 * `CANCELLED-<passengerId>` placeholder so the unique index stays satisfied,
 * and that rename is what frees the seat for anything comparing seat *numbers*.
 * This predicate does something narrower: it stops the placeholder row being
 * read back as an occupied seat, which matters wherever the stored seat number
 * is interpreted rather than matched — the cabin-layout check most of all.
 */
export function heldSeats<T extends object>(scope: T = {} as T): T & typeof HELD_SEAT {
    return { ...scope, ...HELD_SEAT };
}
