-- Type what state a booking is in, and record every move between them (#76).
--
-- `Booking.status` was `TEXT NOT NULL DEFAULT 'CONFIRMED'` with no enum and no
-- check constraint. Unlike `Flight.status` there was not even a Zod schema at
-- the boundary: the whole definition of the domain was a string literal in
-- `lib/seatOccupancy.ts`, whose own comment said so. That literal decides
-- whether a seat is held -- `heldSeats()` filters on `status != 'CANCELLED'` --
-- so a status written any other way sells a seat that somebody is sitting in,
-- or holds one nobody paid for.
--
-- `DISRUPTED` is created here although nothing writes it yet. This migration is
-- where the domain of booking states is decided, and #76 has decided it: a
-- flight cancelled by staff moves its bookings to `DISRUPTED` rather than
-- cancelling them, so the customer keeps the choice between a refund and a
-- rebooking. Adding the value later is not free either -- Postgres will not let
-- a value added by `ALTER TYPE ... ADD VALUE` be used in the same transaction,
-- and Prisma applies each migration in one, so it would take two migrations to
-- add the value and start writing it.
--
-- The status history is the other half. Cancellation, disruption and refunds
-- all have to be auditable, and a single mutable column cannot say what a
-- booking used to be, when it changed, or who changed it.
--
-- To reverse:
--
--     BEGIN;
--     DROP TRIGGER "Booking_records_status_changes" ON "Booking";
--     DROP FUNCTION "record_booking_status_change"();
--     DROP TABLE "BookingStatusChange";
--     DROP FUNCTION "refuse_booking_status_change_update"();
--     ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
--     ALTER TABLE "Booking" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
--     ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';
--     DROP TYPE "BookingStatus";
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260810040000_type_booking_status';
--     COMMIT;
--
-- The order and the transaction both matter, and getting either wrong is worse
-- than not reversing at all. Postgres refuses to retype a column a trigger
-- mentions, so the trigger has to go first -- and run without `BEGIN`, the
-- statements before that refusal commit, leaving `status` as the enum with its
-- default dropped. Every booking insert that omits status then violates NOT
-- NULL, which is every booking the application makes; and since the
-- `_prisma_migrations` row is never reached, `migrate deploy` reports nothing
-- pending and will not heal it.
--
-- Dropping the table discards the audit trail it exists to keep, so reversing
-- this is a decision about the history rather than about the column. The column
-- half is safe in either order against either version of the code: the
-- application only ever writes the names below.
--
-- If the lock timeout aborts this, or the guard rejects the data, the migration
-- is marked failed and no later one applies until it is cleared:
--
--     npx prisma migrate resolve --rolled-back 20260810040000_type_booking_status

-- Fail fast rather than freeze the table.
--
-- The rewrite takes ACCESS EXCLUSIVE on a table read by every profile page and
-- every seat-occupancy check, and `docker compose` starts the one-shot
-- `migrate` service before recreating `app`, so the previous container is still
-- serving from it while this runs. LOCAL, so it lasts only this transaction
-- rather than being inherited by every migration authored after it (#185).
SET LOCAL lock_timeout = '3s';

CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'DISRUPTED');

-- Say what is wrong before the cast does.
--
-- `ALTER TABLE ... USING` fails on an unconvertible row by itself, but names
-- only the first value it choked on, and neither the table nor the column. An
-- operator meeting this mid-deployment needs to see everything that is in there
-- before deciding what each value should become.
DO $$
DECLARE
    unexpected TEXT;
BEGIN
    SELECT string_agg(DISTINCT format('%L (%s rows)', "status", n), ', ')
    INTO unexpected
    FROM (
        SELECT "status", count(*) AS n
        FROM "Booking"
        WHERE "status" NOT IN ('CONFIRMED', 'CANCELLED', 'DISRUPTED')
        GROUP BY "status"
    ) AS outliers;

    IF unexpected IS NOT NULL THEN
        RAISE EXCEPTION
            'Booking.status holds values outside the three statuses: %. '
            'Decide what each should become and update those rows before typing the column.',
            unexpected;
    END IF;
END $$;

-- The default has to go first and come back afterwards: Postgres will not
-- retype a column whose default it cannot cast, and the existing default is a
-- TEXT literal. Losing the last statement would leave every booking created
-- without an explicit status violating NOT NULL.
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Booking"
    ALTER COLUMN "status" TYPE "BookingStatus" USING "status"::"BookingStatus";

ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';

-- One row per move between states.
--
-- `from` is null for the row that records the booking coming into existence,
-- which is the only status a booking has ever had that was not a change from
-- something. `actorUserId` is the person who caused it and is null for a
-- customer acting on their own booking or for a change nothing attributes.
CREATE TABLE "BookingStatusChange" (
    "id" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "from" "BookingStatus",
    "to" "BookingStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingStatusChange_pkey" PRIMARY KEY ("id")
);

-- The history of a booking that no longer exists has no subject, so it goes
-- with it. That is also what keeps the immutability rule below implementable:
-- a rule that blocked deletes would block the cascade, and both the e2e harness
-- and deleting a flight rely on it.
ALTER TABLE "BookingStatusChange"
    ADD CONSTRAINT "BookingStatusChange_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Losing the account does not lose the fact that somebody did it; it loses only
-- which account, which is the same trade `Booking.userId` already makes.
ALTER TABLE "BookingStatusChange"
    ADD CONSTRAINT "BookingStatusChange_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BookingStatusChange_bookingId_createdAt_idx"
    ON "BookingStatusChange"("bookingId", "createdAt");

-- A history that can be rewritten is not one.
--
-- In the database rather than in the application, because the value of an audit
-- trail is precisely that it does not depend on every future caller choosing to
-- respect it -- a repair script, a psql session or a service added later all
-- reach this table without passing through any code this repository owns.
--
-- UPDATE only. Deletes are left to the cascade above: blocking them would make
-- a booking undeletable, and a row whose booking is gone is not evidence of
-- anything.
--
-- One update is allowed, because refusing it would make a *user* undeletable:
-- `actorUserId` is ON DELETE SET NULL, and setting null is an update. So
-- forgetting who did it is permitted -- the same trade `Booking.userId` already
-- makes -- and nothing else is.
--
-- The comparison is against the whole row with that one field cleared, rather
-- than a list of the columns that must not change. A list would go stale the
-- day somebody adds a column, and it would go stale silently, leaving the new
-- column quietly mutable through this path.
--
-- The limit of that, for whoever adds the column: row equality needs an
-- equality operator for every type in the row, and `json`, `xml` and `point`
-- have none. Adding one of those breaks this comparison -- and because the
-- carve-out is what `ON DELETE SET NULL` travels through, deleting a user
-- breaks with it. It fails loudly rather than silently, but `jsonb` is the
-- answer for an audit payload, not `json`.
CREATE OR REPLACE FUNCTION "refuse_booking_status_change_update"()
RETURNS TRIGGER AS $$
DECLARE
    forgotten_actor "BookingStatusChange" := OLD;
BEGIN
    IF OLD."actorUserId" IS NOT NULL AND NEW."actorUserId" IS NULL THEN
        forgotten_actor."actorUserId" := NULL;
        IF NEW IS NOT DISTINCT FROM forgotten_actor THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION
        'BookingStatusChange is append-only: row % belongs to booking % and cannot be '
        'modified. Record a new change instead.',
        OLD."id", OLD."bookingId";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingStatusChange_is_append_only"
    BEFORE UPDATE ON "BookingStatusChange"
    FOR EACH ROW EXECUTE FUNCTION "refuse_booking_status_change_update"();

-- The history writes itself.
--
-- The first version of this had the application insert the row beside the
-- change, nested in the same statement so the two could not come apart. The
-- test fixture that came next created a booking without it and got a booking
-- with no history -- which is the whole objection: "every status change is
-- recorded" was true only while every caller remembered, and callers include a
-- repair script and a psql session.
--
-- So the trigger is the only writer of the automatic rows, and there is no way
-- to change a booking's status without one appearing.
--
-- `reason` and `actorUserId` are the parts a trigger cannot know, so the caller
-- leaves them where it can be read: transaction-local settings, which is why
-- both `set_config` calls must pass `true`. Transaction-local matters more than
-- convenience here -- a session-scoped setting would survive the commit, and
-- the next booking to use that pooled connection would be attributed to
-- whoever set it last.
--
--     BEGIN;
--     SELECT set_config('app.booking_status_reason', 'Cancelled by customer', true);
--     SELECT set_config('app.booking_status_actor', '<user id>', true);
--     UPDATE "Booking" SET "status" = 'CANCELLED' WHERE "id" = 1;
--     COMMIT;
--
-- The transaction is not decoration. `true` means the setting lasts until the
-- end of the current transaction, so issued on its own in autocommit it expires
-- before the next statement begins and the change is recorded unattributed.
-- From the application this means the same `prisma.$transaction` as the write.
--
-- Both are optional and both default to null. `current_setting(..., true)`
-- returns null for a setting that was never set, and the empty string for one
-- set to it, so `nullif` covers the second.
--
-- The id of an automatic row is a uuid, while one written through the Prisma
-- client is a cuid: the column has no database default, so whichever writer
-- made the row chose the shape. Nothing depends on the format.
CREATE OR REPLACE FUNCTION "record_booking_status_change"()
RETURNS TRIGGER AS $$
DECLARE
    reason TEXT := nullif(current_setting('app.booking_status_reason', true), '');
    actor TEXT := nullif(current_setting('app.booking_status_actor', true), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "BookingStatusChange"
            ("id", "bookingId", "from", "to", "reason", "actorUserId", "createdAt")
        VALUES
            (gen_random_uuid()::TEXT, NEW."id", NULL, NEW."status", reason, actor, NEW."createdAt");
    ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
        INSERT INTO "BookingStatusChange"
            ("id", "bookingId", "from", "to", "reason", "actorUserId", "createdAt")
        VALUES
            (gen_random_uuid()::TEXT, NEW."id", OLD."status", NEW."status", reason, actor,
             CURRENT_TIMESTAMP);
    END IF;

    -- AFTER trigger, so the return value is discarded.
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- `UPDATE OF "status"` narrows this to statements that mention the column at
-- all; the `IS DISTINCT FROM` above then drops the ones that set it to what it
-- already was. Neither is redundant: the first keeps every other update off the
-- trigger entirely, the second keeps a no-op write out of the history.
CREATE TRIGGER "Booking_records_status_changes"
    AFTER INSERT OR UPDATE OF "status" ON "Booking"
    FOR EACH ROW EXECUTE FUNCTION "record_booking_status_change"();

-- Give every existing booking the row it would have had.
--
-- Without this, "a booking always has at least one status change" is true only
-- of bookings made after today, and every reader would need a fallback for the
-- others -- which is the shape of two-sources-of-truth this issue is removing.
-- `from` is null and the timestamp is the booking's own, because what is known
-- is the state it is in now and when it was made, not the path it took there.
INSERT INTO "BookingStatusChange" ("id", "bookingId", "from", "to", "reason", "createdAt")
SELECT
    gen_random_uuid()::TEXT,
    b."id",
    NULL,
    b."status",
    'Recorded when the status history was introduced; the path to this state was not kept.',
    b."createdAt"
FROM "Booking" b;
