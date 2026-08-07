-- Type the cabin a seat is held in (#73).
--
-- `SeatAssignment.cabinClass` was `TEXT NOT NULL` with no enum and no check
-- constraint, so the four-cabin rule existed only in the Zod schema at the
-- request boundary. Everything that reaches the table another way -- a repair
-- script, the seed, a service added later -- could write anything at all, and
-- the fare calculation, the seat map and the boarding pass would each read it
-- back and believe it.
--
-- The four names are the ones already in use, so no row needs rewriting. This
-- is a constraint arriving late rather than a change of meaning.
--
-- To reverse:
--
--     ALTER TABLE "SeatAssignment"
--         ALTER COLUMN "cabinClass" TYPE TEXT USING "cabinClass"::TEXT;
--     DROP TYPE "CabinClass";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260807120000_type_cabin_class';
--
-- Safe in either order against either version of the code: the application only
-- ever writes the four names, so old code is fine against the enum and new code
-- is fine against TEXT. There is no code and schema rollback to sequence.

-- Fail fast rather than freeze the table.
--
-- The ALTER below takes ACCESS EXCLUSIVE and rewrites the heap and all three
-- indexes. Measured at ~9.5s per million rows, which is not the problem: the
-- problem is the lock queue. One open reader makes the ALTER wait, and every
-- query arriving behind it waits too, so a migration that would have taken ten
-- seconds can hold the whole table for as long as the longest reader.
--
-- `docker compose` starts the one-shot `migrate` service before recreating
-- `app`, so on a redeploy the previous container is still serving seat maps
-- from this table while this runs. Better to abandon and be retried than to
-- stall reads behind a lock nobody chose to take.
SET lock_timeout = '3s';

CREATE TYPE "CabinClass" AS ENUM ('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST');

-- Say what is wrong before the cast does.
--
-- `ALTER TABLE ... USING` fails on an unconvertible row by itself, but reports
-- only the first value it choked on, with no indication of how much of the
-- table is affected. An operator meeting this during a deployment needs to know
-- what is actually in the column before deciding what each value should become.
DO $$
DECLARE
    unexpected TEXT;
BEGIN
    SELECT string_agg(DISTINCT format('%L (%s rows)', "cabinClass", n), ', ')
    INTO unexpected
    FROM (
        SELECT "cabinClass", count(*) AS n
        FROM "SeatAssignment"
        WHERE "cabinClass" NOT IN ('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST')
        GROUP BY "cabinClass"
    ) AS outliers;

    IF unexpected IS NOT NULL THEN
        RAISE EXCEPTION
            'SeatAssignment.cabinClass holds values outside the four cabins: %. '
            'Decide what each should become and update those rows before typing the column.',
            unexpected;
    END IF;
END $$;

ALTER TABLE "SeatAssignment"
    ALTER COLUMN "cabinClass" TYPE "CabinClass" USING "cabinClass"::"CabinClass";
