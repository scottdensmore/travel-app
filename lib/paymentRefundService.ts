import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type {
    PaymentRefundState,
    PaymentRefundStatus,
    RefundProvider,
} from '@/lib/stripePaymentProvider';

interface RefundSettlement {
    status: PaymentRefundStatus;
    wasSubmitted: boolean;
}

const RETRYABLE_TERMINAL = new Set<PaymentRefundStatus>(['FAILED', 'CANCELLED']);
const PROVIDER_TERMINAL: PaymentRefundStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

export class PaymentRefundService {
    constructor(private readonly provider: RefundProvider) {}

    async settleRefund(refundId: string): Promise<RefundSettlement> {
        const prepared = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${refundId}))`;
            const refund = await tx.paymentRefund.findUniqueOrThrow({
                where: { id: refundId },
                include: {
                    bookingStatusChange: { include: { booking: true } },
                    attempts: { orderBy: { sequence: 'desc' }, take: 1 },
                },
            });
            const change = refund.bookingStatusChange;
            if (
                change.to !== 'CANCELLED'
                || change.refundCents !== refund.amountCents
                || change.booking.paymentIntentId !== refund.providerIntentId
                || change.booking.currency !== refund.currency
            ) {
                throw new Error('Refund does not match the cancelled booking payment.');
            }
            if (refund.status === 'SUCCEEDED') return { refund, attempt: null };

            const current = refund.attempts[0];
            const attempt = !current || RETRYABLE_TERMINAL.has(current.status)
                ? await tx.paymentRefundAttempt.create({
                    data: { id: randomUUID(), paymentRefundId: refund.id },
                })
                : current;
            return { refund, attempt };
        });

        if (!prepared.attempt) return { status: 'SUCCEEDED', wasSubmitted: false };

        const { refund, attempt } = prepared;
        let state: PaymentRefundState | null;
        let wasSubmitted = false;
        if (attempt.providerRefundId) {
            state = await this.provider.retrieveRefund(attempt.providerRefundId);
        } else {
            const lookup = {
                refundId: refund.id,
                refundAttemptId: attempt.id,
                providerIntentId: refund.providerIntentId,
            };
            state = await this.provider.findRefund(lookup);
            if (!state) {
                try {
                    wasSubmitted = true;
                    state = await this.provider.createRefund({
                        ...lookup,
                        amountCents: refund.amountCents,
                    });
                } catch (error) {
                    state = await this.provider.findRefund(lookup);
                    if (!state) throw error;
                }
            }
        }

        if (
            state.paymentRefundId !== refund.id
            || state.refundAttemptId !== attempt.id
            || (
                attempt.providerRefundId !== null
                && state.providerRefundId !== attempt.providerRefundId
            )
        ) {
            throw new Error('Stripe refund metadata does not match the durable refund attempt.');
        }

        const persistedStatus = await prisma.$transaction(async tx => {
            // A provider call cannot hold a database transaction open, so a
            // concurrent reconciliation can finish while this response is in
            // flight. The conditional write takes the attempt row lock and is
            // re-evaluated after a concurrent writer commits, so an older
            // non-terminal response cannot overwrite a terminal provider
            // result made durable by that other call.
            const updated = await tx.paymentRefundAttempt.updateMany({
                where: {
                    id: attempt.id,
                    status: { notIn: PROVIDER_TERMINAL },
                    OR: [
                        { providerRefundId: null },
                        { providerRefundId: state.providerRefundId },
                    ],
                },
                data: {
                    providerRefundId: state.providerRefundId,
                    status: state.status,
                },
            });
            if (updated.count === 0) {
                const current = await tx.paymentRefundAttempt.findUniqueOrThrow({
                    where: { id: attempt.id },
                });
                if (PROVIDER_TERMINAL.includes(current.status)) return current.status;
                throw new Error('Stripe refund metadata does not match the durable refund attempt.');
            }
            await tx.paymentRefund.update({
                where: { id: refund.id },
                data: { status: state.status },
            });
            return state.status;
        });

        return { status: persistedStatus, wasSubmitted };
    }
}
