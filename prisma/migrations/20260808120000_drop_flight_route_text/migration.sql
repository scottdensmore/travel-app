-- Stop storing a flight's route twice (#73).
--
-- `Flight.from` and `Flight.to` were free text that was simultaneously the
-- identity of a place and the words rendered to a customer. Editing the prose
-- silently repointed a route, and nothing stopped a flight naming somewhere no
-- airport exists.
--
-- The references arrived in #189 and every read moved to them in #197, so these
-- two columns have been write-only since. This removes the second answer to
-- "where does this flight go", which is what made the first one unreliable.
--
-- To reverse:
--
--     ALTER TABLE "Flight" ADD COLUMN "from" TEXT, ADD COLUMN "to" TEXT;
--     UPDATE "Flight" f SET "from" = a."label"
--       FROM "Airport" a WHERE a."iataCode" = f."fromAirportCode";
--     UPDATE "Flight" f SET "to" = a."label"
--       FROM "Airport" a WHERE a."iataCode" = f."toAirportCode";
--     ALTER TABLE "Flight" ALTER COLUMN "from" SET NOT NULL,
--                          ALTER COLUMN "to" SET NOT NULL;
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260808120000_drop_flight_route_text';
--
-- The reversal reconstructs the labels from the airports, which is exactly what
-- the guard below proves they already are -- so nothing is lost that the
-- reversal cannot put back. It is safe against either version of the code:
-- old code reads columns that are there again, new code ignores them.
--
-- If the lock timeout aborts this, or the guard rejects the data, the migration
-- is marked failed and no later one applies until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260808120000_drop_flight_route_text

-- Fail fast rather than freeze the table.
--
-- DROP COLUMN takes ACCESS EXCLUSIVE on a table every search reads, and
-- `docker compose` starts the one-shot `migrate` service before recreating
-- `app`, so the previous container is still serving searches while this runs.
-- LOCAL, so it lasts only this transaction: a bare SET commits with the
-- migration and would impose itself on every migration authored afterwards
-- (#185).
SET LOCAL lock_timeout = '3s';

-- Prove the columns are redundant before destroying them.
--
-- Dropping a column is the one change no later migration can undo from the
-- data, so this refuses to run while either column still says something the
-- airports do not. A disagreement means a label was edited after the flight was
-- written, and an operator has to decide which of the two is right -- silently
-- keeping the airport's answer would discard the other one unrecorded.
DO $$
DECLARE
    disagreements TEXT;
    total BIGINT;
BEGIN
    SELECT string_agg(
        format('%s: %L/%L vs %L/%L', "flightNumber", "from", "to", origin_label, destination_label),
        ', '
        ORDER BY "flightNumber"
    )
    INTO disagreements
    FROM (
        SELECT f."flightNumber", f."from", f."to",
               origin."label" AS origin_label,
               destination."label" AS destination_label
        FROM "Flight" f
        -- LEFT, and IS DISTINCT FROM, so a flight referencing an airport that
        -- is not there is reported rather than skipped. An inner join drops
        -- that row, and it is the one row whose label cannot be reconstructed
        -- by the reversal above -- which would then fail on a NOT NULL it
        -- cannot satisfy. Both foreign keys are validated and RESTRICT, so
        -- reaching this needs replication-role trickery; it is handled anyway
        -- because the cost of being wrong here is an unrecoverable reversal.
        LEFT JOIN "Airport" origin ON origin."iataCode" = f."fromAirportCode"
        LEFT JOIN "Airport" destination ON destination."iataCode" = f."toAirportCode"
        WHERE origin."label" IS DISTINCT FROM f."from"
           OR destination."label" IS DISTINCT FROM f."to"
        -- Enough to see the shape of the problem without a megabyte of message.
        -- The count below says how many there really are.
        LIMIT 20
    ) AS mismatched;

    IF disagreements IS NOT NULL THEN
        SELECT count(*) INTO total
        FROM "Flight" f
        LEFT JOIN "Airport" origin ON origin."iataCode" = f."fromAirportCode"
        LEFT JOIN "Airport" destination ON destination."iataCode" = f."toAirportCode"
        WHERE origin."label" IS DISTINCT FROM f."from"
           OR destination."label" IS DISTINCT FROM f."to";

        RAISE EXCEPTION
            'Flight.from/to disagree with the airports these flights reference '
            '(% in total, showing up to 20): %. '
            'Each is a route that reads one way and books another. Decide which is '
            'right and correct the row or the airport label before dropping the columns.',
            total, disagreements;
    END IF;
END $$;

ALTER TABLE "Flight" DROP COLUMN "from";
ALTER TABLE "Flight" DROP COLUMN "to";
