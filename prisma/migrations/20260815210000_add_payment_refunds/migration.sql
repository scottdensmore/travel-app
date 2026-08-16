-- Deliver the exact amount recorded by a cancelled booking to Stripe (#75).
-- The cancellation history remains immutable; this table records only the
-- durable, retryable provider-delivery state and no raw provider payload.
--
-- To reverse:
--
--     BEGIN;
--     DROP TABLE "PaymentRefundAttempt";
--     DROP TABLE "PaymentRefund";
--     DROP TYPE "PaymentRefundStatus";
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260815210000_add_payment_refunds';
--     COMMIT;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "PaymentRefundStatus" AS ENUM (
    'PENDING',
    'REQUIRES_ACTION',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE "PaymentRefund" (
    "id"                    TEXT NOT NULL,
    "bookingStatusChangeId" TEXT NOT NULL,
    "providerIntentId"      TEXT NOT NULL,
    "amountCents"           INTEGER NOT NULL,
    "currency"              TEXT NOT NULL DEFAULT 'USD',
    "status"                "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentRefund_positive_amount" CHECK ("amountCents" > 0),
    CONSTRAINT "PaymentRefund_nonempty_provider_intent"
        CHECK (length(btrim("providerIntentId")) > 0),
    CONSTRAINT "PaymentRefund_currency_format"
        CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "PaymentRefund_bookingStatusChangeId_key"
    ON "PaymentRefund"("bookingStatusChangeId");
CREATE INDEX "PaymentRefund_providerIntentId_idx"
    ON "PaymentRefund"("providerIntentId");
CREATE INDEX "PaymentRefund_status_updatedAt_idx"
    ON "PaymentRefund"("status", "updatedAt");

ALTER TABLE "PaymentRefund"
    ADD CONSTRAINT "PaymentRefund_bookingStatusChangeId_fkey"
    FOREIGN KEY ("bookingStatusChangeId") REFERENCES "BookingStatusChange"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PaymentRefundAttempt" (
    "id"               TEXT NOT NULL,
    "paymentRefundId"  TEXT NOT NULL,
    "providerRefundId" TEXT,
    "status"           "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "sequence"         BIGSERIAL NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefundAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentRefundAttempt_nonempty_id" CHECK (length(btrim("id")) > 0),
    CONSTRAINT "PaymentRefundAttempt_nonempty_provider_refund"
        CHECK ("providerRefundId" IS NULL OR length(btrim("providerRefundId")) > 0)
);

CREATE UNIQUE INDEX "PaymentRefundAttempt_providerRefundId_key"
    ON "PaymentRefundAttempt"("providerRefundId");
CREATE INDEX "PaymentRefundAttempt_paymentRefundId_sequence_idx"
    ON "PaymentRefundAttempt"("paymentRefundId", "sequence");

ALTER TABLE "PaymentRefundAttempt"
    ADD CONSTRAINT "PaymentRefundAttempt_paymentRefundId_fkey"
    FOREIGN KEY ("paymentRefundId") REFERENCES "PaymentRefund"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
