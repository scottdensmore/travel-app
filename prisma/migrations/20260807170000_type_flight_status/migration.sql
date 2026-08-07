-- Type whether a flight is running (#73).
--
-- `Flight.status` was `TEXT NOT NULL DEFAULT 'ON_TIME'` with no enum and no
-- check constraint, so the three-status rule existed only in
-- `flightStatusSchema` at the request boundary. A status written any other way
-- would be filtered on by search, counted by the admin board, and rendered to a
-- customer checking whether their flight is running -- where the board's label
-- lookup falls through to printing the raw value.
--
-- The three names are the ones already in use, so no row changes meaning. This
-- is a constraint arriving late.
--
-- To reverse:
--
--     ALTER TABLE "Flight" ALTER COLUMN "status" DROP DEFAULT;
--     ALTER TABLE "Flight" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
--     ALTER TABLE "Flight" ALTER COLUMN "status" SET DEFAULT 'ON_TIME';
--     DROP TYPE "FlightStatus";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260807170000_type_flight_status';
--
-- Safe in either order against either version of the code: the application only
-- ever writes the three names, so old code is fine against the enum and new
-- code is fine against TEXT.
--
-- If the lock timeout below aborts this, or the guard rejects the data, the
-- migration is marked failed and no later one will apply until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260807170000_type_flight_status
--
-- On a redeploy against live traffic that is the likely path, not the rare one.

-- Fail fast rather than freeze the table.
--
-- The rewrite below takes ACCESS EXCLUSIVE on a table every search reads, and
-- `docker compose` starts the one-shot `migrate` service before recreating
-- `app`, so on a redeploy the previous container is still serving flight
-- searches while this runs. One open reader would otherwise hold the migration,
-- and the migration would hold everything queued behind it.
-- LOCAL, so it lasts only this transaction. A bare `SET` is session-scoped and
-- commits with the migration, and Prisma applies every migration in a deploy
-- over one connection -- so it would silently impose this timeout on every
-- migration authored after it, which would then fail for a reason nothing in
-- its own file explains.
SET LOCAL lock_timeout = '3s';

CREATE TYPE "FlightStatus" AS ENUM ('ON_TIME', 'DELAYED', 'CANCELLED');

-- Say what is wrong before the cast does.
--
-- `ALTER TABLE ... USING` fails on an unconvertible row by itself, but names
-- only the first value it choked on, and neither the table nor the column. An
-- operator meeting this mid-deployment needs to know everything that is in
-- there before deciding what each value should become.
DO $$
DECLARE
    unexpected TEXT;
BEGIN
    SELECT string_agg(DISTINCT format('%L (%s rows)', "status", n), ', ')
    INTO unexpected
    FROM (
        SELECT "status", count(*) AS n
        FROM "Flight"
        WHERE "status" NOT IN ('ON_TIME', 'DELAYED', 'CANCELLED')
        GROUP BY "status"
    ) AS outliers;

    IF unexpected IS NOT NULL THEN
        RAISE EXCEPTION
            'Flight.status holds values outside the three statuses: %. '
            'Decide what each should become and update those rows before typing the column.',
            unexpected;
    END IF;
END $$;

-- The default has to go first and come back afterwards.
--
-- Postgres will not retype a column whose default it cannot cast, and the
-- existing default is a TEXT literal. Dropping it, retyping, then setting it
-- again is the whole reason this migration is three statements rather than one
-- -- and losing the last of them would leave every flight created without an
-- explicit status violating NOT NULL.
ALTER TABLE "Flight" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Flight"
    ALTER COLUMN "status" TYPE "FlightStatus" USING "status"::"FlightStatus";

ALTER TABLE "Flight" ALTER COLUMN "status" SET DEFAULT 'ON_TIME';
