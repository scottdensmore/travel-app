-- Record what a status change refunded, and put the history in order (#76).
--
-- Two additions to `BookingStatusChange`, both needed by the cancellation
-- rules that arrive with them.
--
-- `refundCents` is the amount owed back, decided by `lib/cancellationPolicy.ts`
-- at the moment of the change and recorded beside it. No money moves: real
-- payments are #75, which lands after this, and it will have a figure to refund
-- against rather than having to re-derive one from rules that may have changed
-- since. Null means the change was not one that refunds -- most of them.
--
-- `sequence` exists because `createdAt` cannot order two changes made in one
-- transaction. `CURRENT_TIMESTAMP` is transaction start time, so a booking
-- disrupted and then cancelled in the same transaction carries two rows with
-- the same instant and a random uuid each, leaving "the latest status change"
-- unanswerable by ORDER BY and recoverable only by chaining `from` to `to`.
-- Nothing did that until now, and this slice does.
--
-- To reverse:
--
--     BEGIN;
--     DROP INDEX "BookingStatusChange_bookingId_sequence_idx";
--     ALTER TABLE "BookingStatusChange" DROP COLUMN "sequence";  -- takes its sequence with it
--     ALTER TABLE "BookingStatusChange" DROP COLUMN "refundCents";
--     CREATE OR REPLACE FUNCTION "record_booking_status_change"() ... -- restore the
--         -- body from 20260810040000, which does not mention either column
--     DELETE FROM _prisma_migrations WHERE migration_name = '20260810060000_record_cancellation_refunds';
--     COMMIT;
--
-- The function has to be restored, not just the columns dropped: the version
-- below names both, and a trigger referring to a dropped column fails on the
-- next status change rather than at the moment of the drop. Reversing discards
-- the recorded refunds, which is the same decision as reversing the history
-- table itself.

SET LOCAL lock_timeout = '3s';

-- What the change owed back, in minor units. Null where the change did not
-- refund; zero is a real answer, and a different one -- a cancellation inside
-- the cut-off refunds nothing and says so.
ALTER TABLE "BookingStatusChange" ADD COLUMN "refundCents" INTEGER;

-- Monotonic across the whole table, which is all the ordering needs: rows are
-- only ever compared within one booking, and a sequence shared with other
-- bookings still orders those correctly.
--
-- Added, backfilled and only then defaulted, rather than as a bare BIGSERIAL.
-- BIGSERIAL numbers existing rows in *physical* order, and physical order stops
-- matching insertion order as soon as the heap reuses freed space -- which this
-- table does routinely, because the e2e harness deletes every booking on every
-- run and the history cascades with it. Numbering by `createdAt` on a table
-- whose rows were all written in separate transactions is the ordering the
-- column is for; `id` breaks the ties that leaves.
ALTER TABLE "BookingStatusChange" ADD COLUMN "sequence" BIGINT;

CREATE SEQUENCE "BookingStatusChange_sequence_seq" OWNED BY "BookingStatusChange"."sequence";

UPDATE "BookingStatusChange" existing
SET "sequence" = ordered."position"
FROM (
    SELECT "id", row_number() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "position"
    FROM "BookingStatusChange"
) AS ordered
WHERE ordered."id" = existing."id";

SELECT setval(
    '"BookingStatusChange_sequence_seq"',
    GREATEST((SELECT count(*) FROM "BookingStatusChange"), 1)
);

ALTER TABLE "BookingStatusChange"
    ALTER COLUMN "sequence" SET DEFAULT nextval('"BookingStatusChange_sequence_seq"'),
    ALTER COLUMN "sequence" SET NOT NULL;
CREATE INDEX "BookingStatusChange_bookingId_sequence_idx"
    ON "BookingStatusChange"("bookingId", "sequence");

-- The trigger learns one more setting, on the same transaction-local channel as
-- the reason and the actor. See 20260810040000 for why `true` is not optional.
--
-- Note the settings attach to *every* status change in the transaction, not
-- just the one the caller had in mind: a booking created in the same
-- transaction as a refunded cancellation would carry that refund on its
-- creation row too. Nothing does that today, and the fix if something needs to
-- is to clear the setting between the two writes rather than to widen this.
CREATE OR REPLACE FUNCTION "record_booking_status_change"()
RETURNS TRIGGER AS $$
DECLARE
    reason TEXT := nullif(current_setting('app.booking_status_reason', true), '');
    actor TEXT := nullif(current_setting('app.booking_status_actor', true), '');
    refund INTEGER := nullif(current_setting('app.booking_refund_cents', true), '')::INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "BookingStatusChange"
            ("id", "bookingId", "from", "to", "reason", "actorUserId", "refundCents", "createdAt")
        VALUES
            (gen_random_uuid()::TEXT, NEW."id", NULL, NEW."status", reason, actor, refund,
             NEW."createdAt");
    ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
        INSERT INTO "BookingStatusChange"
            ("id", "bookingId", "from", "to", "reason", "actorUserId", "refundCents", "createdAt")
        VALUES
            (gen_random_uuid()::TEXT, NEW."id", OLD."status", NEW."status", reason, actor, refund,
             CURRENT_TIMESTAMP);
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
