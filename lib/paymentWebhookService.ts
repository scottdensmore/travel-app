import type { PaymentStateProvider } from '@/lib/stripePaymentProvider';
import type { VerifiedPaymentWebhookEvent } from '@/lib/stripeWebhook';
import { prisma } from '@/lib/prisma';
import { lockPaymentIntentForUpdate } from '@/lib/paymentIntentLock';

export interface PaymentWebhookReconciler {
    reconcile(event: VerifiedPaymentWebhookEvent): Promise<void>;
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

            const state = await this.provider.retrievePaymentState(event.providerIntentId);
            if (state.providerIntentId !== event.providerIntentId) {
                throw new Error(
                    'Stripe webhook PaymentIntent did not match the retrieved intent.',
                );
            }
            if (!state.paymentAttemptId) {
                throw new Error('Stripe PaymentIntent has no local payment attempt metadata.');
            }

            const [attempt, existingBinding] = await Promise.all([
                tx.paymentAttempt.findUnique({ where: { id: state.paymentAttemptId } }),
                tx.paymentAttempt.findUnique({
                    where: { providerIntentId: event.providerIntentId },
                    select: { id: true },
                }),
            ]);
            if (!attempt) {
                throw new Error('Payment attempt not found for Stripe webhook.');
            }
            if (
                (attempt.providerIntentId && attempt.providerIntentId !== event.providerIntentId)
                || (existingBinding && existingBinding.id !== attempt.id)
            ) {
                throw new Error('Stripe PaymentIntent is bound to a different payment attempt.');
            }

            await tx.paymentAttempt.update({
                where: { id: attempt.id },
                data: {
                    providerIntentId: event.providerIntentId,
                    status: state.status,
                },
            });
            await tx.paymentWebhookEvent.create({
                data: {
                    id: event.eventId,
                    eventType: event.eventType,
                    providerIntentId: event.providerIntentId,
                    paymentAttemptId: attempt.id,
                },
            });
        }, { maxWait: 5_000, timeout: 15_000 });
    }
}
