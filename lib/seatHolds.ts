import { randomUUID } from 'crypto';
import { prisma } from './prisma';

/**
 * A seat is claimed while somebody is choosing it, and the claim expires.
 *
 * `heldSeats()` answers "has this seat been bought". This answers the question
 * that sits in front of it: is another customer part-way through buying it. The
 * partial unique index on `SeatAssignment` already makes it impossible for two
 * people to *own* 12A; without a hold they could both be invited to try, and
 * the loser found out at the payment step (#74).
 *
 * Every time is the database's. The liveness test and the expiry are both
 * `now()` on the server holding the row, so a clock skew between the
 * application and the database cannot make a hold that reads as live to one and
 * dead to the other -- which for a feature whose whole purpose is deciding
 * races would be the defect it was built to prevent.
 */

/** How long a customer gets to finish choosing before the seat is offered on. */
export const HOLD_MINUTES = 10;

export interface SeatClaim {
    flightId: number;
    seatNumber: string;
    /** A server-derived key identifying one user's single checkout. */
    holderKey: string;
}

/**
 * Bind a browser-generated checkout identifier to the authenticated user.
 *
 * The browser never supplies the complete holder key, so it cannot release a
 * different account's claims. JSON array encoding is unambiguous even if a
 * user identifier contains punctuation that would collide with a delimiter.
 */
export function checkoutHolderKey(userId: string, checkoutId: string): string {
    return JSON.stringify([userId, checkoutId]);
}

/**
 * Claim a seat, or refresh a claim you already hold. True if it is yours.
 *
 * One statement, because two would be a race. Reading whether the seat is free
 * and then writing it loses to the interleaving where both customers read
 * first: each sees a free seat, and both write. `ON CONFLICT` makes the
 * decision inside the row's own lock, so exactly one of two simultaneous
 * callers can come away with it.
 *
 * The conflict target is the unique index on (flightId, seatNumber), and the
 * `WHERE` is what makes an expired hold takeable: the update runs only if the
 * row that is already there is dead, or is yours. Anything else affects no rows
 * and returns false, without raising -- another customer holding a seat is an
 * ordinary answer, not an error.
 */
export async function holdSeat({ flightId, seatNumber, holderKey }: SeatClaim): Promise<boolean> {
    const claimed = await prisma.$executeRaw`
        INSERT INTO "SeatHold" ("id", "flightId", "seatNumber", "holderKey", "createdAt", "expiresAt")
        VALUES (
            ${randomUUID()}, ${flightId}, ${seatNumber}, ${holderKey},
            now(), now() + make_interval(mins => ${HOLD_MINUTES}::int)
        )
        ON CONFLICT ("flightId", "seatNumber") DO UPDATE
            SET "holderKey" = EXCLUDED."holderKey",
                "createdAt" = now(),
                "expiresAt" = now() + make_interval(mins => ${HOLD_MINUTES}::int)
            WHERE "SeatHold"."expiresAt" <= now()
               OR "SeatHold"."holderKey" = EXCLUDED."holderKey"
    `;
    return claimed > 0;
}

/**
 * Give up a claim.
 *
 * Scoped to the holder on purpose: releasing by seat alone would let one
 * customer hand another's seat away, and the caller is whatever the browser
 * sent. A release that matches nothing is silent -- the seat is not yours and
 * the outcome you asked for, that you are not holding it, is already true.
 */
export async function releaseHold({ flightId, seatNumber, holderKey }: SeatClaim): Promise<void> {
    await prisma.seatHold.deleteMany({ where: { flightId, seatNumber, holderKey } });
}

/** Load every live hold once so the two public views cannot disagree. */
async function liveHolds(flightId: number): Promise<{ seatNumber: string; holderKey: string }[]> {
    return prisma.$queryRaw<{ seatNumber: string; holderKey: string }[]>`
        SELECT "seatNumber", "holderKey" FROM "SeatHold"
        WHERE "flightId" = ${flightId}
          AND "expiresAt" > now()
        ORDER BY "seatNumber"
    `;
}

/** The seats on this flight held by a different checkout. */
export async function seatsHeldByOthers(flightId: number, holderKey: string): Promise<string[]> {
    const held = await liveHolds(flightId);
    return held.filter(row => row.holderKey !== holderKey).map(row => row.seatNumber);
}

/** Every live hold on a flight, for journeys that do not own a checkout. */
export async function seatsOnHold(flightId: number): Promise<string[]> {
    const held = await liveHolds(flightId);
    return held.map(row => row.seatNumber);
}

/**
 * Let go of every seat this checkout holds on these flights except the ones
 * named.
 *
 * Without it a checkout that goes back and changes its mind strands the seat
 * they abandoned for the rest of its ten minutes, and every swap costs
 * inventory nobody is going to buy. Scoped to one checkout's holder key, so a
 * second tab belonging to the same customer is left alone.
 */
export async function releaseHoldsExcept(
    flightIds: number[],
    holderKey: string,
    keep: { flightId: number; seatNumber: string }[],
): Promise<void> {
    await prisma.seatHold.deleteMany({
        where: {
            holderKey,
            flightId: { in: flightIds },
            NOT: { OR: keep.map(({ flightId, seatNumber }) => ({ flightId, seatNumber })) },
        },
    });
}
