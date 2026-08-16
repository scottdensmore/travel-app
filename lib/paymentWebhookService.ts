import type { PaymentAttemptStatus, Prisma } from '@prisma/client';
import type { PaymentStateProvider } from '@/lib/stripePaymentProvider';
import type { VerifiedPaymentWebhookEvent } from '@/lib/stripeWebhook';
import { prisma } from '@/lib/prisma';
import { lockPaymentIntentForUpdate } from '@/lib/paymentIntentLock';

export interface PaymentWebhookReconciler {
    reconcile(event: VerifiedPaymentWebhookEvent): Promise<void>;
}

export interface PaymentAttemptReconciliationResult {
    attemptId: string;
    previousStatus: PaymentAttemptStatus;
    status: PaymentAttemptStatus;
    changed: boolean;
    updatedAt: Date;
}

async function reconcilePaymentIntent(
    tx: Prisma.TransactionClient,
    provider: PaymentStateProvider,
    providerIntentId: string,
    expectedAttemptId?: string,
): Promise<PaymentAttemptReconciliationResult> {
    const state = await provider.retrievePaymentState(providerIntentId);
    if (state.providerIntentId !== providerIntentId) {
        throw new Error(
            'Stripe webhook PaymentIntent did not match the retrieved intent.',
        );
    }
    if (!state.paymentAttemptId) {
        throw new Error('Stripe PaymentIntent has no local payment attempt metadata.');
    }
    if (expectedAttemptId && state.paymentAttemptId !== expectedAttemptId) {
        throw new Error('Stripe PaymentIntent is bound to a different payment attempt.');
    }
    const [attempt, existingBinding] = await Promise.all([
        tx.paymentAttempt.findUnique({ where: { id: state.paymentAttemptId } }),
        tx.paymentAttempt.findUnique({
            where: { providerIntentId },
            select: { id: true },
        }),
    ]);
    if (!attempt) {
        throw new Error('Payment attempt not found for Stripe webhook.');
    }
    if (
        (attempt.providerIntentId && attempt.providerIntentId !== providerIntentId)
        || (existingBinding && existingBinding.id !== attempt.id)
    ) {
        throw new Error('Stripe PaymentIntent is bound to a different payment attempt.');
    }

    const updated = await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
            providerIntentId,
            status: state.status,
        },
    });
    return {
        attemptId: attempt.id,
        previousStatus: attempt.status,
        status: state.status,
        changed: attempt.status !== state.status,
        updatedAt: updated.updatedAt,
    };
}

/**
 * Re-read one durable attempt from Stripe without fabricating a webhook event.
 *
 * Staff use this after an expected webhook or provider response is missing.
 * The provider intent lock is shared with checkout and webhook processing, so
 * an older read cannot overwrite a newer result that is still in flight.
 */
export class PaymentAttemptReconciliationService {
    constructor(private readonly provider: PaymentStateProvider) {}

    async reconcileAttempt(attemptId: string): Promise<PaymentAttemptReconciliationResult> {
        const initial = await prisma.paymentAttempt.findUnique({
            where: { id: attemptId },
            select: { providerIntentId: true },
        });
        if (!initial?.providerIntentId) {
            throw new Error('Payment attempt cannot be reconciled without a provider intent.');
        }
        const providerIntentId = initial.providerIntentId;

        return prisma.$transaction(async tx => {
            await lockPaymentIntentForUpdate(tx, providerIntentId);
            const current = await tx.paymentAttempt.findUnique({
                where: { id: attemptId },
                select: { providerIntentId: true },
            });
            if (current?.providerIntentId !== providerIntentId) {
                throw new Error('Payment attempt provider binding changed during reconciliation.');
            }
            return reconcilePaymentIntent(
                tx,
                this.provider,
                providerIntentId,
                attemptId,
            );
        }, { maxWait: 5_000, timeout: 15_000 });
    }
}

export class PaymentWebhookService implements PaymentWebhookReconciler {
    constructor(private readonly provider: PaymentStateProvider) {}

    async reconcile(event: VerifiedPaymentWebhookEvent): Promise<void> {
        await prisma.$transaction(async tx => {
            await lockPaymentIntentForUpdate(tx, event.providerIntentId);

            const duplicate = await tx.paymentWebhookEvent.findUnique({
                where: { id: event.eventId },
                select: { id: true },
            });
            if (duplicate) return;

            const result = await reconcilePaymentIntent(
                tx,
                this.provider,
                event.providerIntentId,
            );
            await tx.paymentWebhookEvent.create({
                data: {
                    id: event.eventId,
                    eventType: event.eventType,
                    providerIntentId: event.providerIntentId,
                    paymentAttemptId: result.attemptId,
                },
            });
        }, { maxWait: 5_000, timeout: 15_000 });
    }
}
