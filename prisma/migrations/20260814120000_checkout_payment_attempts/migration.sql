-- Persist a server-priced Stripe payment attempt before checkout creates a
-- booking (#75).
--
-- Card numbers, CVCs and expiry dates never enter this schema: Stripe Elements
-- tokenizes them in Stripe's frame. The PaymentIntent client secret is also
-- response-only. This table keeps only the provider identifier and the values
-- needed to make a retry, capture or reconciliation refer to the same quote.
--
-- `CREATING` is durable before the provider call. Its row ID becomes Stripe's
-- idempotency key, closing the failure window where Stripe accepted a request
-- but the application died before saving the provider intent ID.
--
-- To reverse:
--
--     BEGIN;
--     DROP TABLE "PaymentAttempt";
--     DROP TYPE "PaymentAttemptStatus";
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260814120000_checkout_payment_attempts';
--     COMMIT;
--
-- Reversal discards the only local link to in-flight provider intents. Cancel
-- or reconcile those intents first; dropping the table itself affects no
-- booking because this first slice does not connect attempts to bookings yet.

SET LOCAL lock_timeout = '3s';

CREATE TYPE "PaymentAttemptStatus" AS ENUM (
    'CREATING',
    'REQUIRES_PAYMENT_METHOD',
    'REQUIRES_CONFIRMATION',
    'REQUIRES_ACTION',
    'PROCESSING',
    'AUTHORIZED',
    'CAPTURED',
    'CANCELLED'
);

CREATE TABLE "PaymentAttempt" (
    "id"                 TEXT NOT NULL,
    "checkoutId"         TEXT NOT NULL,
    "userId"             TEXT,
    "requestFingerprint" TEXT NOT NULL,
    "amountCents"        INTEGER NOT NULL,
    "currency"           TEXT NOT NULL DEFAULT 'USD',
    "providerIntentId"   TEXT,
    "status"             "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATING',
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentAttempt_positive_amount" CHECK ("amountCents" > 0),
    CONSTRAINT "PaymentAttempt_iso_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "PaymentAttempt_sha256_fingerprint"
        CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "PaymentAttempt_providerIntentId_key"
    ON "PaymentAttempt"("providerIntentId");
CREATE UNIQUE INDEX "PaymentAttempt_userId_checkoutId_key"
    ON "PaymentAttempt"("userId", "checkoutId");
CREATE INDEX "PaymentAttempt_status_updatedAt_idx"
    ON "PaymentAttempt"("status", "updatedAt");

ALTER TABLE "PaymentAttempt"
    ADD CONSTRAINT "PaymentAttempt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
