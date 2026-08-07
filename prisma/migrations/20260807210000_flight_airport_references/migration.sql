-- Point a flight at the airports it touches (#73).
--
-- `Flight.from` and `Flight.to` carry free text -- 'Seattle, USA' -- which is
-- both the identity of the place and the words rendered to a customer. Editing
-- the prose therefore silently repoints the route, and nothing stops a flight
-- naming somewhere no airport exists.
--
-- This is the first of two steps. It adds the references and fills them; the
-- reads still render `from`/`to`, and dropping those columns is the second
-- step, once every read path has moved. Splitting it keeps each change
-- reviewable and each rollback a single statement, which is the shape #135 and
-- #137 used for the same reason.
--
-- To reverse:
--
--     ALTER TABLE "Flight" DROP CONSTRAINT "Flight_toAirportCode_fkey";
--     ALTER TABLE "Flight" DROP CONSTRAINT "Flight_fromAirportCode_fkey";
--     ALTER TABLE "Flight" DROP COLUMN "toAirportCode";
--     ALTER TABLE "Flight" DROP COLUMN "fromAirportCode";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260807210000_flight_airport_references';
--
-- Safe against either version of the code while `from`/`to` remain: nothing
-- reads the new columns yet.
--
-- If the guard below rejects the data, the migration is marked failed and no
-- later one applies until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260807210000_flight_airport_references

-- LOCAL, so it lasts only this transaction rather than being inherited by every
-- migration written after it.
SET LOCAL lock_timeout = '3s';

-- Nullable first, so the backfill has somewhere to write.
ALTER TABLE "Flight" ADD COLUMN "fromAirportCode" TEXT;
ALTER TABLE "Flight" ADD COLUMN "toAirportCode" TEXT;

UPDATE "Flight" f
SET "fromAirportCode" = origin."iataCode"
FROM "Airport" origin
WHERE origin."label" = f."from";

UPDATE "Flight" f
SET "toAirportCode" = destination."iataCode"
FROM "Airport" destination
WHERE destination."label" = f."to";

-- Say which places are unaccounted for, rather than which constraint failed.
--
-- A route naming somewhere with no airport row is a data question, not a schema
-- one: someone has to decide whether the airport is missing from the reference
-- data or the flight is wrong. NOT NULL would report neither the place nor how
-- many flights are stranded on it.
DO $$
DECLARE
    unmatched TEXT;
BEGIN
    SELECT string_agg(DISTINCT format('%L (%s flights)', place, n), ', ')
    INTO unmatched
    FROM (
        SELECT "from" AS place, count(*) AS n FROM "Flight" WHERE "fromAirportCode" IS NULL GROUP BY "from"
        UNION ALL
        SELECT "to" AS place, count(*) AS n FROM "Flight" WHERE "toAirportCode" IS NULL GROUP BY "to"
    ) AS gaps;

    IF unmatched IS NOT NULL THEN
        RAISE EXCEPTION
            'No airport matches these places named by flights: %. '
            'Add them to the Airport table, or correct the flights, before referencing airports.',
            unmatched;
    END IF;
END $$;

ALTER TABLE "Flight" ALTER COLUMN "fromAirportCode" SET NOT NULL;
ALTER TABLE "Flight" ALTER COLUMN "toAirportCode" SET NOT NULL;

ALTER TABLE "Flight"
    ADD CONSTRAINT "Flight_fromAirportCode_fkey"
    FOREIGN KEY ("fromAirportCode") REFERENCES "Airport"("iataCode")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Flight"
    ADD CONSTRAINT "Flight_toAirportCode_fkey"
    FOREIGN KEY ("toAirportCode") REFERENCES "Airport"("iataCode")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Flight_fromAirportCode_idx" ON "Flight"("fromAirportCode");
CREATE INDEX "Flight_toAirportCode_idx" ON "Flight"("toAirportCode");
