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
    /** The signed-in user today; a checkout session when guests can book. */
    holderKey: string;
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

/**
 * The seats on this flight that somebody *else* is currently holding.
 *
 * Excludes your own, or the seat a customer just picked would grey out under
 * them. Sorted so a caller can compare the list without minding the order the
 * rows came back in.
 */
export async function seatsHeldByOthers(flightId: number, holderKey: string): Promise<string[]> {
    const held = await prisma.$queryRaw<{ seatNumber: string }[]>`
        SELECT "seatNumber" FROM "SeatHold"
        WHERE "flightId" = ${flightId}
          AND "holderKey" <> ${holderKey}
          AND "expiresAt" > now()
        ORDER BY "seatNumber"
    `;
    return held.map(row => row.seatNumber);
}

/**
 * Let go of every seat this customer holds on these flights except the ones
 * named.
 *
 * Without it a customer who goes back and changes their mind strands the seat
 * they abandoned for the rest of its ten minutes, and every swap costs
 * inventory nobody is going to buy. Scoped to the holder, so it can only ever
 * release seats that were already theirs.
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
