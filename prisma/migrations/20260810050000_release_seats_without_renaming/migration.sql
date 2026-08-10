-- Release a seat by saying so, not by renaming it (#76).
--
-- Cancelling a booking overwrote each seat number with
-- `CANCELLED-<passengerId>`. Nothing wanted that string: it existed only to
-- stop `UNIQUE (flightId, seatNumber)` from holding the seat forever, since the
-- index could not tell a held seat from a released one. So the fix for an index
-- that was too strict was to destroy the data it indexed.
--
-- What that cost:
--
--   * The seat number is gone. Which seat somebody was in before they cancelled
--     is not recoverable from this table, and this migration cannot put it back
--     -- the value was overwritten in place. Rows released from here on keep it.
--   * Every reader had to know the convention. `seatLabel` translated the
--     placeholder back into the word "Released" so it never reached a customer,
--     and a `CANCELLED-` prefix check stood between the two.
--   * "Is this seat taken" needed a join to the booking's status, because the
--     seat row itself could not say.
--
-- A partial unique index answers all three: uniqueness applies to held seats
-- only, so a released row can keep its real seat number and a new customer can
-- take that seat.
--
-- Note the index is invisible to Prisma, which cannot express a `WHERE` clause
-- on `@@unique`. That is why `@@unique([flightId, seatNumber])` is gone from
-- the schema rather than replaced: leaving it would have Prisma recreate the
-- unconditional index, which is the constraint being removed. `migrate diff`
-- reports no drift -- it ignores what it cannot represent -- so this index
-- lives and dies with this file, and a later migration that means to change it
-- has to say so here.
--
-- To reverse:
--
--     BEGIN;
--     DROP TRIGGER "Booking_releases_seats_when_cancelled" ON "Booking";
--     DROP FUNCTION "release_seats_on_cancellation"();
--     DROP INDEX "SeatAssignment_flightId_releasedAt_idx";
--     UPDATE "SeatAssignment" SET "seatNumber" = 'CANCELLED-' || "passengerId"
--         WHERE "releasedAt" IS NOT NULL;
--     DROP INDEX "SeatAssignment_flightId_seatNumber_held_key";
--     CREATE UNIQUE INDEX "SeatAssignment_flightId_seatNumber_key"
--         ON "SeatAssignment"("flightId", "seatNumber");
--     ALTER TABLE "SeatAssignment" DROP COLUMN "releasedAt";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260810050000_release_seats_without_renaming';
--     COMMIT;
--
-- The placeholder statement is not optional and it is lossy: the old index
-- cannot be recreated while two rows on a flight share a seat number, which is
-- exactly what this migration allows, so the reversal has to reimpose the
-- placeholder and discard the real seat numbers again. Reversing therefore
-- destroys data that reversing cannot restore -- unlike every other migration
-- here.
--
-- And the placeholder it reimposes is only unique per flight while a traveller
-- holds at most one released seat on that flight. An itinerary with two legs on
-- the same flight would produce the same `CANCELLED-<passengerId>` twice and
-- the CREATE UNIQUE INDEX would fail. That is what the transaction is for: the
-- reversal rolls back whole rather than leaving the table with no unique index
-- at all.
--
-- If the guard below rejects the data, the migration is marked failed and no
-- later one applies until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260810050000_release_seats_without_renaming

-- Fail fast rather than freeze the table.
--
-- Dropping and creating an index takes locks on the table every seat map reads,
-- and `docker compose` starts the one-shot `migrate` service before recreating
-- `app`. LOCAL, so it lasts only this transaction rather than being inherited
-- by every migration authored after it (#185).
SET LOCAL lock_timeout = '3s';

ALTER TABLE "SeatAssignment" ADD COLUMN "releasedAt" TIMESTAMP(3);

-- When the seat was let go.
--
-- For rows already carrying the placeholder this is an approximation, and the
-- best one available: the booking's move to CANCELLED, which for a booking
-- cancelled before #228 is itself the backfilled row carrying the booking's
-- creation time. The alternative was CURRENT_TIMESTAMP, which would claim every
-- historical cancellation happened during this deployment.
UPDATE "SeatAssignment" sa
SET "releasedAt" = COALESCE(
    (
        SELECT max(c."createdAt")
        FROM "ItineraryLeg" l
        JOIN "BookingStatusChange" c ON c."bookingId" = l."bookingId"
        WHERE l."id" = sa."legId" AND c."to" = 'CANCELLED'
    ),
    (
        SELECT b."createdAt"
        FROM "ItineraryLeg" l
        JOIN "Booking" b ON b."id" = l."bookingId"
        WHERE l."id" = sa."legId"
    )
)
WHERE sa."seatNumber" LIKE 'CANCELLED-%';

-- Every placeholder has to become a released row, or it stays held forever
-- under a seat number no customer can be given.
--
-- Reaching this through the schema as it stands takes a broken foreign key:
-- `legId` references a leg whose `bookingId` is NOT NULL, whose `createdAt` is
-- NOT NULL, so the COALESCE above cannot come back empty. What it does catch is
-- the backfill above being weakened or removed, which is the change somebody is
-- actually likely to make -- so the message names that first and does not
-- assert a diagnosis it cannot know.
DO $$
DECLARE
    stranded bigint;
BEGIN
    SELECT count(*) INTO stranded
    FROM "SeatAssignment"
    WHERE "seatNumber" LIKE 'CANCELLED-%' AND "releasedAt" IS NULL;

    IF stranded > 0 THEN
        RAISE EXCEPTION
            'Refusing to change the seat index: % placeholder seats have no release date, so '
            'they would stay held under a seat number nobody can be given. Either the backfill '
            'above did not run over them, or their legs have no booking -- which the foreign '
            'keys should make impossible.', stranded;
    END IF;
END $$;

DROP INDEX "SeatAssignment_flightId_seatNumber_key";

-- Strictly weaker than the index it replaces, so no existing row can violate
-- it: the old one held across every row, held or not.
CREATE UNIQUE INDEX "SeatAssignment_flightId_seatNumber_held_key"
    ON "SeatAssignment"("flightId", "seatNumber")
    WHERE "releasedAt" IS NULL;

-- Reading "which seats on this flight are taken" no longer joins to the
-- booking, so the column it filters on is worth an index of its own.
CREATE INDEX "SeatAssignment_flightId_releasedAt_idx"
    ON "SeatAssignment"("flightId", "releasedAt");

-- A cancelled booking never holds a seat.
--
-- Splitting the release out of the status makes the two capable of disagreeing,
-- which the old join made impossible: a booking could now read CANCELLED while
-- its seats stayed held, and the seat map would keep showing them taken with
-- nothing to point at. That is not a state anything should be able to reach, so
-- it is not left to the caller that happens to know both facts.
--
-- Only on the way *into* CANCELLED. `DISRUPTED` deliberately keeps its seats:
-- a flight the airline cancelled leaves the customer choosing between a refund
-- and a rebooking, and the seat is theirs until they do (#76). And a seat
-- released for some other reason is not un-released by a booking that was
-- already cancelled.
CREATE OR REPLACE FUNCTION "release_seats_on_cancellation"()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "SeatAssignment" sa
    SET "releasedAt" = CURRENT_TIMESTAMP
    FROM "ItineraryLeg" l
    WHERE l."id" = sa."legId"
      AND l."bookingId" = NEW."id"
      AND sa."releasedAt" IS NULL;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Booking_releases_seats_when_cancelled"
    AFTER UPDATE OF "status" ON "Booking"
    FOR EACH ROW
    WHEN (NEW."status" = 'CANCELLED' AND OLD."status" IS DISTINCT FROM 'CANCELLED')
    EXECUTE FUNCTION "release_seats_on_cancellation"();
