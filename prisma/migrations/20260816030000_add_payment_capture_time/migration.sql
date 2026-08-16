-- Record when a payment first becomes captured so receipts do not mislabel
-- authorization creation or later webhook activity as the payment date (#75).
-- Existing captured attempts use their last durable update as the best
-- available historical value; new captures are stamped by the trigger.
--
-- To reverse:
--
--     BEGIN;
--     DROP TRIGGER "PaymentAttempt_set_captured_at" ON "PaymentAttempt";
--     DROP FUNCTION set_payment_attempt_captured_at();
--     ALTER TABLE "PaymentAttempt"
--       DROP CONSTRAINT "PaymentAttempt_captured_has_time",
--       DROP COLUMN "capturedAt";
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260816030000_add_payment_capture_time';
--     COMMIT;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "PaymentAttempt"
    ADD COLUMN "capturedAt" TIMESTAMP(3);

UPDATE "PaymentAttempt"
SET "capturedAt" = "updatedAt"
WHERE "status" = 'CAPTURED';

CREATE FUNCTION set_payment_attempt_captured_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."capturedAt" IS NOT NULL THEN
        NEW."capturedAt" := OLD."capturedAt";
    ELSIF NEW."status" = 'CAPTURED' THEN
        NEW."capturedAt" := clock_timestamp();
    ELSE
        NEW."capturedAt" := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentAttempt_set_captured_at"
BEFORE INSERT OR UPDATE OF "status", "capturedAt" ON "PaymentAttempt"
FOR EACH ROW
EXECUTE FUNCTION set_payment_attempt_captured_at();

ALTER TABLE "PaymentAttempt"
    ADD CONSTRAINT "PaymentAttempt_captured_has_time"
    CHECK (("status" = 'CAPTURED') = ("capturedAt" IS NOT NULL));
