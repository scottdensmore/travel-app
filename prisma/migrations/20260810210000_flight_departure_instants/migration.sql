-- Store when a flight actually leaves (#84).
--
-- `Flight.departureDate` was `timestamp(3)` without a zone, holding the
-- schedule's *local* wall clock with a `Z` stapled on by
-- `FlightScheduleService`: a Tokyo flight departing 08:00 was stored as 08:00Z,
-- which is 17:00 in Tokyo. It was never an instant, so nothing could compare it
-- to one.
--
-- Everything that treated it as a moment in time was therefore wrong by the
-- origin airport's offset:
--
--   * #76's cancellation guard refuses a booking whose flight has departed.
--     East of UTC a flown flight stayed cancellable for the length of the
--     offset -- nine hours for Tokyo -- releasing a seat that was used and
--     taking back the status points for a trip the customer took. West of UTC
--     it refused cancellations that should have been allowed.
--   * Search, the status board and the booking window all sorted and filtered
--     on it.
--
-- The conversion is not a reinterpretation of the same number: each row's value
-- is read as local time at its origin and turned into the instant it names.
-- Rows move by their origin's offset, which is the point.
--
-- Expand and contract rather than an in-place ALTER, because the cast needs a
-- per-row timezone from a joined table and `USING` cannot reach one.
--
-- To reverse:
--
--     BEGIN;
--     ALTER TABLE "Flight" ADD COLUMN "departureLocal" TIMESTAMP(3);
--     UPDATE "Flight" f SET "departureLocal" =
--         f."departureDate" AT TIME ZONE a."timeZone"
--         FROM "Airport" a WHERE a."iataCode" = f."fromAirportCode";
--     ALTER TABLE "Flight" DROP COLUMN "departureDate";
--     ALTER TABLE "Flight" RENAME COLUMN "departureLocal" TO "departureDate";
--     ALTER TABLE "Flight" ALTER COLUMN "departureDate" SET NOT NULL;
--     CREATE UNIQUE INDEX "Flight_flightNumber_departureDate_key"
--         ON "Flight"("flightNumber", "departureDate");
--     CREATE INDEX "Flight_departureDate_idx" ON "Flight"("departureDate");
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260810210000_flight_departure_instants';
--     COMMIT;
--
-- That restores the wall-clock reading for every row whose original wall clock
-- was a time that exists. A row whose original fell inside a spring-forward gap
-- comes back an hour later, because the conversion resolved it forward and the
-- reversal cannot know it had been moved -- measured at 18 of 20 exact on a
-- fixture built to include two such rows. It also restores the defects above,
-- and any flight created after this migration will read as local time in a
-- column the old code treats as UTC.
--
-- If the guard below rejects the data, the migration is marked failed and no
-- later one applies until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260810210000_flight_departure_instants

-- Fail fast rather than freeze the table.
--
-- This rewrites every row of a table each search reads, and `docker compose`
-- starts the one-shot `migrate` service before recreating `app`. LOCAL, so the
-- timeout lasts only this transaction rather than being inherited by every
-- migration authored after it (#185).
SET LOCAL lock_timeout = '3s';

-- Every flight needs a zone to be converted through.
--
-- `fromAirportCode` is a NOT NULL foreign key and `Airport.timeZone` is NOT
-- NULL, so this cannot fire through the schema as it stands. It is here because
-- the alternative to failing is converting a row through the wrong zone and
-- never knowing: a silently mis-timed flight looks exactly like a correct one.
DO $$
DECLARE
    unzoned bigint;
BEGIN
    SELECT count(*) INTO unzoned
    FROM "Flight" f
    LEFT JOIN "Airport" a ON a."iataCode" = f."fromAirportCode"
    WHERE a."timeZone" IS NULL OR a."timeZone" = '';

    IF unzoned > 0 THEN
        RAISE EXCEPTION
            'Refusing to convert departures: % flights have an origin with no timezone, and '
            'converting them through a guessed zone would mis-time them invisibly.', unzoned;
    END IF;
END $$;

ALTER TABLE "Flight" ADD COLUMN "departureInstant" TIMESTAMPTZ(3);

-- `timestamp AT TIME ZONE 'Asia/Tokyo'` reads the value as local in that zone
-- and yields the instant it names -- the exact inverse of how the value was
-- written. Postgres applies the offset that was in force on that date, so
-- flights either side of a daylight-saving change convert differently, which is
-- correct and is what a fixed offset per airport would have got wrong.
UPDATE "Flight" f
SET "departureInstant" = f."departureDate" AT TIME ZONE a."timeZone"
FROM "Airport" a
WHERE a."iataCode" = f."fromAirportCode";

DO $$
DECLARE
    unconverted bigint;
BEGIN
    SELECT count(*) INTO unconverted FROM "Flight" WHERE "departureInstant" IS NULL;

    IF unconverted > 0 THEN
        RAISE EXCEPTION
            'Refusing to convert departures: % flights were not converted, so dropping the '
            'old column would lose their departure time.', unconverted;
    END IF;
END $$;

-- Dropping the column takes its indexes with it, so both have to come back.
-- The unique pair is the guard against generating the same occurrence twice;
-- the plain index is what search and the status board order by, and is the one
-- #167 asked for on a column that was range-scanned without it.
ALTER TABLE "Flight" DROP COLUMN "departureDate";
ALTER TABLE "Flight" RENAME COLUMN "departureInstant" TO "departureDate";
ALTER TABLE "Flight" ALTER COLUMN "departureDate" SET NOT NULL;

CREATE UNIQUE INDEX "Flight_flightNumber_departureDate_key"
    ON "Flight"("flightNumber", "departureDate");
CREATE INDEX "Flight_departureDate_idx" ON "Flight"("departureDate");
