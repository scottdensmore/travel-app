-- Generated occurrences need durable provenance before an administrator can be
-- told truthfully which flights a schedule edit will affect (#237, #83).
-- Flight number alone is not provenance: manual occurrences may share it, and
-- airlines can reuse a number across different timetable patterns.
--
-- Existing rows are linked only when their number, route, origin-local wall
-- clock, and operating weekday identify exactly one schedule. Zero or multiple
-- matches stay NULL rather than acquiring a guessed history.
--
-- Rollback:
--   ALTER TABLE "Flight" DROP CONSTRAINT "Flight_flightScheduleId_fkey";
--   DROP INDEX "Flight_flightScheduleId_idx";
--   ALTER TABLE "Flight" DROP COLUMN "flightScheduleId";

ALTER TABLE "Flight" ADD COLUMN "flightScheduleId" INTEGER;

WITH candidates AS (
    SELECT
        f."id" AS "flightId",
        s."id" AS "scheduleId"
    FROM "Flight" f
    JOIN "Airport" origin ON origin."iataCode" = f."fromAirportCode"
    JOIN "Airport" destination ON destination."iataCode" = f."toAirportCode"
    JOIN "FlightSchedule" s
      ON s."flightNumber" = f."flightNumber"
     AND s."from" = origin."label"
     AND s."to" = destination."label"
     AND s."departureTime" = to_char(
         f."departureDate" AT TIME ZONE origin."timeZone",
         'HH24:MI'
     )
     AND EXTRACT(
         DOW FROM f."departureDate" AT TIME ZONE origin."timeZone"
     )::INTEGER = ANY(s."daysOfWeek")
), unambiguous AS (
    SELECT "flightId", MIN("scheduleId") AS "scheduleId"
    FROM candidates
    GROUP BY "flightId"
    HAVING COUNT(*) = 1
)
UPDATE "Flight" f
SET "flightScheduleId" = unambiguous."scheduleId"
FROM unambiguous
WHERE f."id" = unambiguous."flightId";

CREATE INDEX "Flight_flightScheduleId_idx" ON "Flight"("flightScheduleId");

ALTER TABLE "Flight"
    ADD CONSTRAINT "Flight_flightScheduleId_fkey"
    FOREIGN KEY ("flightScheduleId") REFERENCES "FlightSchedule"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
