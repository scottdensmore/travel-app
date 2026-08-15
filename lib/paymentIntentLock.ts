import type { Prisma } from '@prisma/client';

type PaymentIntentLockClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Serialises every local write derived from one Stripe PaymentIntent.
 *
 * Both checkout responses and webhooks can carry an older snapshot. Holding
 * this lock while retrieving Stripe's current object makes the provider read
 * and the local write one ordered operation, so whichever path runs last also
 * observes the newest provider state.
 */
export async function lockPaymentIntentForUpdate(
    tx: PaymentIntentLockClient,
    providerIntentId: string,
): Promise<void> {
    await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
            hashtextextended(${providerIntentId}, 7501)
        )::text AS "locked"
    `;
}
