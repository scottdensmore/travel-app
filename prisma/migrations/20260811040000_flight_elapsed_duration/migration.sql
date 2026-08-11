-- How long a flight takes, stated rather than inferred (#84).
--
-- Nothing recorded it. An arrival time could therefore only ever be guessed,
-- and the obvious guess is the one this issue warns against: subtracting a
-- displayed local departure from a displayed local arrival. Across a timezone
-- that is not a duration at all -- Tokyo to San Francisco "arrives before it
-- leaves" -- and it is wrong by an hour twice a year even within one zone.
--
-- The duration is elapsed minutes, so it is the same number whatever either end
-- of the route is doing with its clocks. The arrival *instant* is not stored:
-- it is `departureDate + durationMinutes`, exact arithmetic on an instant with
-- no zone involved, and storing it as well would be a second answer that can
-- disagree with the first. This repository has removed three of those (#135,
-- #137, #73) and should not add one back. The issue asks for both stored; the
-- derivation is the same value with one fewer way to be wrong, and it is
-- recorded on the issue as a deliberate reading.
--
-- `FlightSchedule.durationMinutes` is NOT NULL: a schedule is the statement of
-- intent, and one that cannot say how long its flight takes is incomplete.
-- `Flight.durationMinutes` is nullable, because a flight row can be created
-- directly -- fixtures and tests do -- and a missing duration should render as
-- "no arrival time" rather than fail. Every flight the generator makes inherits
-- its schedule's.
--
-- To reverse:
--
--     BEGIN;
--     ALTER TABLE "Flight" DROP COLUMN "durationMinutes";
--     ALTER TABLE "FlightSchedule" DROP COLUMN "durationMinutes";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260811040000_flight_elapsed_duration';
--     COMMIT;
--
-- Lossless in the sense that nothing else derives from these columns, but the
-- durations themselves are not recoverable: they are stated data, not computed,
-- so reversing discards them.
--
-- If the guard below rejects the data, the migration is marked failed and no
-- later one applies until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260811040000_flight_elapsed_duration

SET LOCAL lock_timeout = '3s';

ALTER TABLE "FlightSchedule" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "Flight" ADD COLUMN "durationMinutes" INTEGER;

-- Scheduled block times for the routes this airline flies, in minutes.
--
-- The same numbers `lib/data/FlightData.ts` seeds with. Duplicated here because
-- a migration cannot import them, and keyed by route rather than flight number
-- so that renaming a flight does not silently lose its duration. Both
-- directions are listed: they differ, because the wind does.
CREATE TEMP TABLE route_block_minutes (origin TEXT, destination TEXT, minutes INTEGER) ON COMMIT DROP;
INSERT INTO route_block_minutes VALUES
    ('SEA', 'DTW', 245),
    ('DTW', 'SEA', 285),
    ('JFK', 'LHR', 420),
    ('LHR', 'JFK', 485),
    ('SFO', 'HND', 680),
    ('HND', 'SFO', 575),
    ('ORD', 'CDG', 510),
    ('CDG', 'ORD', 560),
    ('MIA', 'GIG', 525),
    ('GIG', 'MIA', 500);

-- Schedules name their route in words, and the words are an airport's label.
UPDATE "FlightSchedule" s
SET "durationMinutes" = r.minutes
FROM route_block_minutes r
JOIN "Airport" origin ON origin."iataCode" = r.origin
JOIN "Airport" destination ON destination."iataCode" = r.destination
WHERE s."from" = origin."label" AND s."to" = destination."label";

-- Flights carry airport references, so they join directly.
UPDATE "Flight" f
SET "durationMinutes" = r.minutes
FROM route_block_minutes r
WHERE f."fromAirportCode" = r.origin AND f."toAirportCode" = r.destination;

-- A schedule with no duration cannot become NOT NULL, and guessing one would
-- put an invented arrival time on a customer's booking.
DO $$
DECLARE
    unstated TEXT;
BEGIN
    SELECT string_agg(format('%s (%s to %s)', "flightNumber", "from", "to"), ', ')
    INTO unstated
    FROM "FlightSchedule"
    WHERE "durationMinutes" IS NULL;

    IF unstated IS NOT NULL THEN
        RAISE EXCEPTION
            'Refusing to require a duration: these schedules fly a route with no stated '
            'block time, and inventing one would put a made-up arrival time on a '
            'customer''s booking: %. Add the route to the table in this migration, or '
            'retire those schedules. Giving them a duration first is not an option: the '
            'column does not exist until this migration creates it, and adding it by hand '
            'makes the migration fail on its own ADD COLUMN instead.', unstated;
    END IF;
END $$;

ALTER TABLE "FlightSchedule" ALTER COLUMN "durationMinutes" SET NOT NULL;

-- A duration has to be a positive number of minutes. Zero would make an arrival
-- equal its departure, and negative would make it earlier.
ALTER TABLE "FlightSchedule"
    ADD CONSTRAINT "FlightSchedule_durationMinutes_positive" CHECK ("durationMinutes" > 0);
ALTER TABLE "Flight"
    ADD CONSTRAINT "Flight_durationMinutes_positive"
    CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0);
