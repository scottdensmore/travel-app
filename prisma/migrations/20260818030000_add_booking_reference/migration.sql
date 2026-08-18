-- Give every booking a stable customer-facing confirmation reference (#77).
--
-- The numeric primary key remains the internal relation key. Exposing it as a
-- confirmation number makes references predictable and couples every customer
-- artefact to storage order. The reference below is random, unique, formatted
-- for transcription, and immutable across cancellation and rebooking.
-- It is still an identifier rather than a credential: application reads remain
-- scoped to the authenticated booking owner.
--
-- Existing bookings are backfilled before NOT NULL is applied. The generator
-- carries 80 random bits; the unique index is the final authority if an
-- astronomically unlikely collision occurs.
--
-- To reverse before any reference has been handed to a customer:
--
--     BEGIN;
--     DROP TRIGGER "Booking_reference_is_immutable" ON "Booking";
--     DROP FUNCTION "refuse_booking_reference_update"();
--     DROP INDEX "Booking_reference_key";
--     ALTER TABLE "Booking" DROP CONSTRAINT "Booking_reference_format";
--     ALTER TABLE "Booking" DROP COLUMN "reference";
--     DROP FUNCTION "generate_booking_reference"();
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260818030000_add_booking_reference';
--     COMMIT;
--
-- Once a reference appears on a confirmation, receipt or support record,
-- reversal destroys an external identifier and needs an explicit migration
-- plan rather than the SQL above.

SET LOCAL lock_timeout = '3s';

CREATE FUNCTION "generate_booking_reference"()
RETURNS TEXT AS $$
    SELECT 'MA-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20));
$$ LANGUAGE SQL VOLATILE;

ALTER TABLE "Booking" ADD COLUMN "reference" TEXT;

UPDATE "Booking"
SET "reference" = "generate_booking_reference"()
WHERE "reference" IS NULL;

ALTER TABLE "Booking"
    ALTER COLUMN "reference" SET NOT NULL,
    ALTER COLUMN "reference" SET DEFAULT "generate_booking_reference"(),
    ADD CONSTRAINT "Booking_reference_format"
        CHECK ("reference" ~ '^MA-[0-9A-F]{20}$');

CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

CREATE FUNCTION "refuse_booking_reference_update"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."reference" IS DISTINCT FROM OLD."reference" THEN
        RAISE EXCEPTION 'Booking reference is immutable for booking %.', OLD."id";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Booking_reference_is_immutable"
    BEFORE UPDATE OF "reference" ON "Booking"
    FOR EACH ROW EXECUTE FUNCTION "refuse_booking_reference_update"();
