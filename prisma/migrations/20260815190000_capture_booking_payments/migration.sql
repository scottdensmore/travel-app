-- Link each completed booking to the one Stripe PaymentIntent whose
-- authorization pays for it (#75). Legacy bookings remain null.
--
-- To reverse:
--
--     BEGIN;
--     DROP INDEX "Booking_paymentIntentId_key";
--     ALTER TABLE "Booking"
--       DROP CONSTRAINT "Booking_nonempty_payment_intent";
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260815190000_capture_booking_payments';
--     COMMIT;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Booking"
        WHERE "paymentIntentId" IS NOT NULL
          AND length(btrim("paymentIntentId")) = 0
    ) THEN
        RAISE EXCEPTION 'Booking contains an empty paymentIntentId';
    END IF;

    IF EXISTS (
        SELECT "paymentIntentId"
        FROM "Booking"
        WHERE "paymentIntentId" IS NOT NULL
        GROUP BY "paymentIntentId"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Booking contains a duplicate paymentIntentId';
    END IF;
END $$;

ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_nonempty_payment_intent"
    CHECK (
        "paymentIntentId" IS NULL
        OR length(btrim("paymentIntentId")) > 0
    );

CREATE UNIQUE INDEX "Booking_paymentIntentId_key"
    ON "Booking"("paymentIntentId");
