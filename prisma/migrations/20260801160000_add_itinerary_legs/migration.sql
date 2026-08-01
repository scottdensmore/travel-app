-- A booking becomes a sequence of flights rather than exactly one.
--
-- There is no separate itinerary table: it would be one-to-one with "Booking"
-- and carry no columns of its own, so a booking is its own itinerary.
--
-- "Booking"."flightId" is deliberately retained and still written. Reads move to
-- the legs in this change; dropping the column belongs to a later step, once
-- round trips actually produce a second leg and the backfill has been observed
-- in a deployed environment.
CREATE TABLE "ItineraryLeg" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "flightId" INTEGER NOT NULL,

    CONSTRAINT "ItineraryLeg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItineraryLeg_bookingId_sequence_key" ON "ItineraryLeg"("bookingId", "sequence");
CREATE INDEX "ItineraryLeg_flightId_idx" ON "ItineraryLeg"("flightId");

ALTER TABLE "ItineraryLeg"
    ADD CONSTRAINT "ItineraryLeg_bookingId_fkey" FOREIGN KEY ("bookingId")
        REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ItineraryLeg_flightId_fkey" FOREIGN KEY ("flightId")
        REFERENCES "Flight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A leg must be ordered from 1 upward, so an itinerary can never contain a
-- zeroth or negative leg.
ALTER TABLE "ItineraryLeg"
ADD CONSTRAINT "ItineraryLeg_sequence_positive_check" CHECK ("sequence" >= 1);

-- Every existing booking is a one-leg itinerary.
INSERT INTO "ItineraryLeg" ("bookingId", "sequence", "flightId")
SELECT "id", 1, "flightId"
FROM "Booking"
WHERE "flightId" IS NOT NULL;
