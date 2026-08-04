-- Contract step for the traveller record (#137).
--
-- "Passenger" fused a traveller with a seat on one flight. A traveller is one
-- person per booking; a seat is one per leg. Keeping both meant every reader
-- had to be told which was authoritative, and four separate defects came from
-- getting that wrong -- an outbound seat change overwriting the return seat
-- (#126), return-leg occupancy answered from the outbound seat, a cabin layout
-- change stranding a return-leg seat, and the admin manifest showing outbound
-- seats on an inbound occurrence (#127).
--
-- Every reader moved to "SeatAssignment" in #127, and the last three fallbacks
-- went in #146. Nothing reads these columns.
--
-- The invariant that made removing the fallbacks safe is checked again here
-- rather than trusted: every traveller must hold an assignment on every leg of
-- their booking. If that is false anywhere, this migration fails loudly instead
-- of silently discarding the only record of where somebody sits.
DO $$
DECLARE
    orphans bigint;
BEGIN
    SELECT count(*) INTO orphans
    FROM "Passenger" p
    JOIN "ItineraryLeg" l ON l."bookingId" = p."bookingId"
    LEFT JOIN "SeatAssignment" sa
        ON sa."passengerId" = p.id AND sa."legId" = l.id
    WHERE sa.id IS NULL;

    IF orphans > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop Passenger seat columns: % passenger-legs have no SeatAssignment', orphans;
    END IF;
END $$;

-- Dropping these removes "Passenger"'s unique seat index with them, leaving
-- "SeatAssignment"'s UNIQUE (flightId, seatNumber) as the sole guard against
-- two customers acquiring the same seat. That is the intended end state: both
-- tables enforced it during the expand phase precisely so there was never a
-- moment with no guard at all.
ALTER TABLE "Passenger" DROP CONSTRAINT IF EXISTS "Passenger_flightId_fkey";
ALTER TABLE "Passenger" DROP COLUMN "seatNumber";
ALTER TABLE "Passenger" DROP COLUMN "cabinClass";
ALTER TABLE "Passenger" DROP COLUMN "flightId";
