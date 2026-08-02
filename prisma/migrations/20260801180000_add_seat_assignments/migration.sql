-- Separate where someone sits from who they are.
--
-- "Passenger" fused a traveller with a seat on one flight. A traveller is one
-- person per booking; a seat is one per leg. A round trip would otherwise need a
-- second "Passenger" row for the same person, duplicating their encrypted
-- passport and date of birth along with the retention deadlines attached to them.
--
-- "Passenger"."seatNumber", "cabinClass" and "flightId" are deliberately retained
-- and still written, together with their unique constraint. Both tables enforce
-- the same invariant during the expand phase, so there is no moment where
-- nothing prevents two customers acquiring the same seat.

-- A seat assignment references the leg and its flight together, so the
-- denormalised flightId can never disagree with the leg it belongs to.
CREATE UNIQUE INDEX "ItineraryLeg_id_flightId_key" ON "ItineraryLeg"("id", "flightId");

CREATE TABLE "SeatAssignment" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "legId" INTEGER NOT NULL,
    "flightId" INTEGER NOT NULL,
    "seatNumber" TEXT NOT NULL,
    "cabinClass" TEXT NOT NULL,

    CONSTRAINT "SeatAssignment_pkey" PRIMARY KEY ("id")
);

-- The guard against two customers acquiring the same seat, carried over from
-- "Passenger" rather than replaced.
CREATE UNIQUE INDEX "SeatAssignment_flightId_seatNumber_key"
    ON "SeatAssignment"("flightId", "seatNumber");

-- A traveller sits in exactly one seat on any given leg.
CREATE UNIQUE INDEX "SeatAssignment_passengerId_legId_key"
    ON "SeatAssignment"("passengerId", "legId");

ALTER TABLE "SeatAssignment"
    ADD CONSTRAINT "SeatAssignment_passengerId_fkey" FOREIGN KEY ("passengerId")
        REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "SeatAssignment_legId_flightId_fkey" FOREIGN KEY ("legId", "flightId")
        REFERENCES "ItineraryLeg"("id", "flightId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "SeatAssignment_flightId_fkey" FOREIGN KEY ("flightId")
        REFERENCES "Flight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing passenger already sits on the single leg of their booking.
INSERT INTO "SeatAssignment" ("id", "passengerId", "legId", "flightId", "seatNumber", "cabinClass")
SELECT
    gen_random_uuid()::text,
    passenger."id",
    leg."id",
    passenger."flightId",
    passenger."seatNumber",
    passenger."cabinClass"
FROM "Passenger" passenger
JOIN "ItineraryLeg" leg
    ON leg."bookingId" = passenger."bookingId"
    AND leg."flightId" = passenger."flightId";
