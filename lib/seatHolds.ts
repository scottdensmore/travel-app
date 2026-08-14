import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { lockFlightForUpdate } from './flightLock';
import { prisma } from './prisma';
import { heldSeats } from './seatOccupancy';

/**
 * A seat is claimed while somebody is choosing it, and the claim expires.
 *
 * `heldSeats()` answers "has this seat been bought". This answers the question
 * that sits in front of it: is another customer part-way through buying it. The
 * partial unique index on `SeatAssignment` already makes it impossible for two
 * people to *own* 12A; without a hold they could both be invited to try, and
 * the loser found out at the payment step (#74).
 *
 * Every time is the database's. The liveness test and the expiry both use
 * statement time on the server holding the row, so a clock skew between the
 * application and the database cannot make a hold that reads as live to one and
 * dead to the other. Transaction-start time is deliberately not used: a
 * transaction may wait on the Flight lock until a once-live hold has expired.
 */

/** How long a customer gets to finish choosing before the seat is offered on. */
export const HOLD_MINUTES = 10;

export interface SeatClaim {
    flightId: number;
    seatNumber: string;
    /** A server-derived key identifying one user's single checkout. */
    holderKey: string;
}

export interface SeatHoldBatchResult {
    taken: SeatClaim[];
    /** The first claimed seat the database will consider expired. */
    expiresAt: Date | null;
    /** Its lifetime remaining against the database clock at response time. */
    expiresInMilliseconds: number;
}

export class SeatHoldUnavailableError extends Error {
    readonly claim: SeatClaim;

    constructor(claim: SeatClaim) {
        super(`Seat ${claim.seatNumber} is no longer held for this checkout. Please choose a seat again.`);
        this.name = 'SeatHoldUnavailableError';
        this.claim = claim;
    }
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
async function claimSeat(
    tx: Prisma.TransactionClient,
    { flightId, seatNumber, holderKey }: SeatClaim,
): Promise<boolean> {
    const claimed = await tx.$executeRaw`
        INSERT INTO "SeatHold" ("id", "flightId", "seatNumber", "holderKey", "createdAt", "expiresAt")
        VALUES (
            ${randomUUID()}, ${flightId}, ${seatNumber}, ${holderKey},
            statement_timestamp(),
            statement_timestamp() + make_interval(mins => ${HOLD_MINUTES}::int)
        )
        ON CONFLICT ("flightId", "seatNumber") DO UPDATE
            SET "holderKey" = EXCLUDED."holderKey",
                "createdAt" = statement_timestamp(),
                "expiresAt" = statement_timestamp() + make_interval(mins => ${HOLD_MINUTES}::int)
            WHERE "SeatHold"."expiresAt" <= statement_timestamp()
               OR "SeatHold"."holderKey" = EXCLUDED."holderKey"
    `;
    return claimed > 0;
}

function claimIdentity({ flightId, seatNumber }: Pick<SeatClaim, 'flightId' | 'seatNumber'>): string {
    return `${flightId}:${seatNumber}`;
}

async function releaseHoldsExceptInTransaction(
    tx: Prisma.TransactionClient,
    flightIds: number[],
    holderKey: string,
    keep: { flightId: number; seatNumber: string }[],
): Promise<void> {
    await tx.seatHold.deleteMany({
        where: {
            holderKey,
            flightId: { in: flightIds },
            NOT: { OR: keep.map(({ flightId, seatNumber }) => ({ flightId, seatNumber })) },
        },
    });
}

/**
 * Replace this checkout's chosen set and report the claims it could not take.
 *
 * Every hold mutation takes the same Flight locks as booking, in the same
 * order. The flight row is the durable exclusion boundary even when a hold row
 * does not exist yet; locking only SeatHold rows cannot protect that insert
 * race. Sorting the claims also keeps two multi-seat checkouts from acquiring
 * the same rows in opposite orders and deadlocking.
 */
export async function holdSeats(claims: SeatClaim[]): Promise<SeatHoldBatchResult> {
    if (claims.length === 0) {
        return { taken: [], expiresAt: null, expiresInMilliseconds: 0 };
    }

    const holderKeys = new Set(claims.map(claim => claim.holderKey));
    if (holderKeys.size !== 1) {
        throw new Error('Seat claims must belong to one checkout.');
    }
    const holderKey = claims[0].holderKey;
    const flightIds = [...new Set(claims.map(claim => claim.flightId))]
        .sort((left, right) => left - right);
    const orderedClaims = [...claims].sort((left, right) => (
        left.flightId - right.flightId || left.seatNumber.localeCompare(right.seatNumber)
    ));

    return prisma.$transaction(async (tx) => {
        for (const flightId of flightIds) {
            await lockFlightForUpdate(tx, flightId);
        }

        await releaseHoldsExceptInTransaction(tx, flightIds, holderKey, claims);

        const occupied = new Set<string>();
        for (const flightId of flightIds) {
            const seats = await tx.seatAssignment.findMany({
                where: heldSeats({ flightId }),
                select: { seatNumber: true },
            });
            for (const { seatNumber } of seats) {
                occupied.add(claimIdentity({ flightId, seatNumber }));
            }
        }

        const taken = new Set<string>();
        for (const claim of orderedClaims) {
            const identity = claimIdentity(claim);
            if (occupied.has(identity) || !await claimSeat(tx, claim)) {
                taken.add(identity);
            }
        }

        const takenClaims = claims.filter(claim => taken.has(claimIdentity(claim)));
        const heldClaims = claims.filter(claim => !taken.has(claimIdentity(claim)));
        if (heldClaims.length === 0) {
            return { taken: takenClaims, expiresAt: null, expiresInMilliseconds: 0 };
        }

        // Read the exact set while the Flight locks are still ours. Looking up
        // all rows for the holder would let an abandoned leg from a different
        // request shorten this checkout's promise. The minimum is the only
        // truthful deadline for a multi-passenger, multi-leg set.
        const heldRows = await tx.seatHold.findMany({
            where: {
                holderKey,
                OR: heldClaims.map(({ flightId, seatNumber }) => ({ flightId, seatNumber })),
            },
            select: { expiresAt: true },
        });
        const expiresAt = heldRows.reduce<Date | null>((earliest, row) => (
            earliest === null || row.expiresAt < earliest ? row.expiresAt : earliest
        ), null);
        if (expiresAt === null) {
            throw new Error('Claimed seats have no hold expiry.');
        }

        const [clock] = await tx.$queryRaw<{ now: Date }[]>`
            SELECT statement_timestamp() AS "now"
        `;
        if (!clock) throw new Error('Database clock was unavailable.');

        return {
            taken: takenClaims,
            expiresAt,
            expiresInMilliseconds: Math.max(0, expiresAt.getTime() - clock.now.getTime()),
        };
    });
}

export async function holdSeat(claim: SeatClaim): Promise<boolean> {
    return (await holdSeats([claim])).taken.length === 0;
}

/** Consume one live claim while its Flight row is already locked for booking. */
export async function consumeSeatHold(
    tx: Prisma.TransactionClient,
    { flightId, seatNumber, holderKey }: SeatClaim,
): Promise<boolean> {
    const consumed = await tx.$executeRaw`
        DELETE FROM "SeatHold"
        WHERE "flightId" = ${flightId}
          AND "seatNumber" = ${seatNumber}
          AND "holderKey" = ${holderKey}
          AND "expiresAt" > statement_timestamp()
    `;
    return consumed === 1;
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
    await prisma.$transaction(async (tx) => {
        await lockFlightForUpdate(tx, flightId);
        await tx.seatHold.deleteMany({ where: { flightId, seatNumber, holderKey } });
    });
}

/** Load every live hold once so the two public views cannot disagree. */
async function liveHolds(flightId: number): Promise<{ seatNumber: string; holderKey: string }[]> {
    return prisma.$queryRaw<{ seatNumber: string; holderKey: string }[]>`
        SELECT "seatNumber", "holderKey" FROM "SeatHold"
        WHERE "flightId" = ${flightId}
          AND "expiresAt" > statement_timestamp()
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
    const orderedFlightIds = [...new Set(flightIds)].sort((left, right) => left - right);
    await prisma.$transaction(async (tx) => {
        for (const flightId of orderedFlightIds) {
            await lockFlightForUpdate(tx, flightId);
        }
        await releaseHoldsExceptInTransaction(tx, orderedFlightIds, holderKey, keep);
    });
}
