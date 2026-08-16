import type { Prisma } from '@prisma/client';

type FlightLockClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

export async function lockFlightForUpdate(tx: FlightLockClient, flightId: number): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Flight" WHERE "id" = ${flightId} FOR UPDATE`;
}

/**
 * Locks the bookings touching a flight, so two staff transactions changing two
 * legs of one itinerary cannot both decide its status from a stale snapshot.
 *
 * Locking the flight is not enough. `updateFlightStatusAction` decides each
 * booking's new status by reading the statuses of *other* flights -- the other
 * legs -- and those rows belong to flights this transaction does not hold. Under
 * READ COMMITTED two concurrent changes each read the other's pre-image, and
 * both are wrong: cancelling one leg while reinstating another left the booking
 * CONFIRMED on a cancelled flight, and reinstating both at once left it
 * DISRUPTED while both flights operated (#76).
 *
 * The booking row is what they have in common, so it is what serialises them.
 * Ascending id, matching every other lock order in this application, so two
 * transactions holding overlapping sets cannot form a cycle. Once the second
 * transaction is through the lock its next statement takes a fresh snapshot and
 * sees the first one's committed work.
 */
export async function lockBookingsOnFlightForUpdate(
    tx: FlightLockClient,
    flightId: number,
): Promise<number[]> {
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT b."id"
        FROM "Booking" b
        WHERE EXISTS (
            SELECT 1 FROM "ItineraryLeg" l
            WHERE l."bookingId" = b."id"
              AND l."flightId" = ${flightId}
              AND l."supersededAt" IS NULL
        )
        AND b."status" <> 'CANCELLED'
        ORDER BY b."id"
        FOR UPDATE
    `;
    return locked.map(row => row.id);
}
