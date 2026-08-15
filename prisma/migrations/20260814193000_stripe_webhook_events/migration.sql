-- Record each signed Stripe PaymentIntent event only after its current provider
-- state has been reconciled into the local payment attempt (#75).
--
-- The raw webhook body is intentionally not stored. Stripe event and intent
-- identifiers, the event type and the local attempt link are enough to make
-- retries idempotent without retaining unnecessary provider/customer data.
--
-- To reverse:
--
--     BEGIN;
--     DROP TABLE "PaymentWebhookEvent";
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260814193000_stripe_webhook_events';
--     COMMIT;
--
-- Reversal loses local webhook delivery history but does not change a payment
-- attempt's last reconciled status.

SET LOCAL lock_timeout = '3s';

CREATE TABLE "PaymentWebhookEvent" (
    "id"                 TEXT NOT NULL,
    "eventType"          TEXT NOT NULL,
    "providerIntentId"   TEXT NOT NULL,
    "paymentAttemptId"   TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentWebhookEvent_nonempty_event_type"
        CHECK (length("eventType") > 0),
    CONSTRAINT "PaymentWebhookEvent_nonempty_provider_intent"
        CHECK (length("providerIntentId") > 0)
);

CREATE INDEX "PaymentWebhookEvent_providerIntentId_idx"
    ON "PaymentWebhookEvent"("providerIntentId");
CREATE INDEX "PaymentWebhookEvent_paymentAttemptId_idx"
    ON "PaymentWebhookEvent"("paymentAttemptId");

ALTER TABLE "PaymentWebhookEvent"
    ADD CONSTRAINT "PaymentWebhookEvent_paymentAttemptId_fkey"
    FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
