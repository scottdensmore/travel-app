-- Hold a seat while the customer is choosing it (#74).
--
-- A seat only became unavailable once a booking existed, so between picking 12A
-- and paying for it the seat stayed on every other customer's map. The loser of
-- that race reached the payment step and was told the seat had gone. The
-- partial unique index on SeatAssignment already stops two customers *buying*
-- the same seat; this stops them both being invited to try.
--
-- A hold is not an assignment and does not live in that table. An assignment is
-- a seat someone owns and is part of a booking's history; a hold is a claim
-- with a deadline, belonging to nobody's itinerary, and putting a
-- not-yet-purchased row in SeatAssignment would make every query that counts
-- held seats -- four of them, all through `heldSeats()` -- have to learn the
-- difference.
--
-- The unique index is unconditional rather than partial, which is the opposite
-- of the choice made for SeatAssignment in
-- `20260810050000_release_seats_without_renaming`, and deliberately so. An
-- expired hold is not deleted; it is taken over in place by the next customer,
-- via ON CONFLICT DO UPDATE. So there is never a second row for the same seat,
-- dead or alive, and a partial index would permit exactly the duplicates this
-- design does not want.
--
-- Both timestamps are TIMESTAMPTZ, following `Flight.departureDate` (#84). The
-- naive form stores what `now()` looked like under the writing session's
-- TimeZone and compares it back under the reading session's, so one hold read
-- from three sessions answered "430 minutes left" in Los Angeles and "expired
-- 530 minutes ago" in Tokyo. Deciding races on a value that means different
-- instants to different connections is the defect this table exists to prevent,
-- wearing a different hat.
--
-- Nothing sweeps expired rows. That is the point: an abandoned checkout stops
-- mattering on its own, so there is no cleanup job whose failure would
-- permanently reduce inventory. The rows are small and are reused rather than
-- accumulating per seat.
--
-- To reverse:
--
--     BEGIN;
--     DROP TABLE "SeatHold";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260811120000_seat_holds';
--     COMMIT;
--
-- Lossless: nothing else references these rows, and a hold that vanishes only
-- means a seat becomes offerable again, which is what expiry does anyway.

SET LOCAL lock_timeout = '3s';

CREATE TABLE "SeatHold" (
    "id"         TEXT NOT NULL,
    "flightId"   INTEGER NOT NULL,
    "seatNumber" TEXT NOT NULL,
    "holderKey"  TEXT NOT NULL,
    "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "expiresAt"  TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

-- One live claim per seat; see the note above on why this is not partial.
CREATE UNIQUE INDEX "SeatHold_flightId_seatNumber_key" ON "SeatHold"("flightId", "seatNumber");
-- Every read filters on liveness.
CREATE INDEX "SeatHold_expiresAt_idx" ON "SeatHold"("expiresAt");
-- "which seats am *I* holding" is asked on every seat map render.
CREATE INDEX "SeatHold_holderKey_idx" ON "SeatHold"("holderKey");

ALTER TABLE "SeatHold"
    ADD CONSTRAINT "SeatHold_flightId_fkey"
    FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A hold that has already expired when it is written is a bug in the caller,
-- not a state to store: it would be invisible to every read and would occupy
-- the seat's one row, so the next customer could take it over but no query
-- would ever show it as held.
ALTER TABLE "SeatHold"
    ADD CONSTRAINT "SeatHold_expires_after_it_is_made"
    CHECK ("expiresAt" > "createdAt");
