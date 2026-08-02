-- Contract step for the itinerary (#109, #111).
--
-- A booking's flights are its legs. "flightId" was retained and still written so
-- a rollback of #109 kept the single reference, and #111 moved the readers onto
-- the legs.
--
-- Two readers survived that change and moved in this one: the idempotency check
-- in FlightBookingService, which compared the persisted flight, and the
-- occupied-seats lookup behind the seat-change modal. Both now read the outbound
-- leg.
--
-- Every booking has a leg: the #109 migration backfilled one per existing
-- booking, and bookings taken since create theirs with the booking itself.
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_flightId_fkey";
ALTER TABLE "Booking" DROP COLUMN "flightId";
