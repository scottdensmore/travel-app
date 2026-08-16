'use client';

import type { PaymentAttemptStatus } from '@prisma/client';
import React, { useEffect, useRef, useState, useTransition } from 'react';
import { reconcilePaymentAttemptAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { formatPrice } from '@/lib/bookingPricing';

export interface PaymentRecoveryItem {
    id: string;
    checkoutId: string;
    providerIntentId: string;
    amountCents: number;
    currency: string;
    status: PaymentAttemptStatus;
    updatedAt: string;
    userName: string | null;
    userEmail: string | null;
}

interface PaymentRecoveryQueueProps {
    initialAttempts: PaymentRecoveryItem[];
}

type Feedback = {
    kind: 'success' | 'error';
    message: string;
};

const TERMINAL_STATUSES = new Set<PaymentAttemptStatus>(['CAPTURED', 'CANCELLED']);

function formattedUpdatedAt(value: string): string {
    return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(new Date(value));
}

export default function PaymentRecoveryQueue({ initialAttempts }: PaymentRecoveryQueueProps) {
    const [attempts, setAttempts] = useState(initialAttempts);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [, startTransition] = useTransition();
    const feedbackRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (feedback) feedbackRef.current?.focus();
    }, [feedback]);

    const reconcile = (attemptId: string) => {
        setFeedback(null);
        setPendingId(attemptId);
        startTransition(async () => {
            try {
                const result = await reconcilePaymentAttemptAction(attemptId);
                if (isActionValidationFailure(result)) {
                    setFeedback({ kind: 'error', message: result.error.message });
                    return;
                }

                setAttempts(current => current.map(attempt => (
                    attempt.id === result.attemptId
                        ? { ...attempt, status: result.status, updatedAt: result.updatedAt }
                        : attempt
                )));
                setFeedback({
                    kind: 'success',
                    message: result.changed
                        ? `Payment status refreshed from ${result.previousStatus} to ${result.status}.`
                        : `Payment status is still ${result.status}.`,
                });
            } catch {
                setFeedback({
                    kind: 'error',
                    message: 'Payment status could not be refreshed. Try again later.',
                });
            } finally {
                setPendingId(null);
            }
        });
    };

    return (
        <section aria-labelledby="payment-recovery-heading" className="admin-card">
            <h2 id="payment-recovery-heading" style={{ marginTop: 0, color: '#c084fc' }}>
                Stale payment attempts
            </h2>
            <p style={{ color: 'rgba(255, 255, 255, 0.72)' }}>
                Provider-backed checkouts appear here after ten minutes without a local payment update.
                Refreshing reads Stripe&apos;s current state; it does not charge or cancel the payment.
            </p>

            {feedback && (
                <div
                    ref={feedbackRef}
                    role={feedback.kind === 'error' ? 'alert' : 'status'}
                    tabIndex={-1}
                    className={`payment-recovery-feedback payment-recovery-feedback--${feedback.kind}`}
                >
                    {feedback.message}
                </div>
            )}

            {attempts.length === 0 ? (
                <p style={{ color: 'rgba(255, 255, 255, 0.6)', marginBottom: 0 }}>
                    No stale payment attempts need review.
                </p>
            ) : (
                <div className="payment-recovery-list">
                    {attempts.map(attempt => {
                        const isPending = pendingId === attempt.id;
                        const isTerminal = TERMINAL_STATUSES.has(attempt.status);
                        return (
                            <article
                                key={attempt.id}
                                aria-label={`Payment attempt ${attempt.id}`}
                                className="payment-recovery-card"
                            >
                                <div className="payment-recovery-details">
                                    <div>
                                        <span className="payment-recovery-label">Customer</span>
                                        <strong>{attempt.userName ?? 'Account unavailable'}</strong>
                                        {attempt.userEmail && <span>{attempt.userEmail}</span>}
                                    </div>
                                    <div>
                                        <span className="payment-recovery-label">Amount</span>
                                        <strong>{formatPrice(attempt.amountCents)} {attempt.currency}</strong>
                                    </div>
                                    <div>
                                        <span className="payment-recovery-label">Local status</span>
                                        <strong>{attempt.status}</strong>
                                    </div>
                                    <div>
                                        <span className="payment-recovery-label">Last local update</span>
                                        <span>{formattedUpdatedAt(attempt.updatedAt)} UTC</span>
                                    </div>
                                    <div>
                                        <span className="payment-recovery-label">Stripe intent</span>
                                        <code>{attempt.providerIntentId}</code>
                                    </div>
                                    <div>
                                        <span className="payment-recovery-label">Checkout</span>
                                        <code>{attempt.checkoutId}</code>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => reconcile(attempt.id)}
                                    disabled={pendingId !== null || isTerminal}
                                    aria-busy={isPending || undefined}
                                >
                                    {isPending
                                        ? 'Refreshing payment status…'
                                        : isTerminal
                                            ? 'Payment reconciled'
                                            : 'Refresh payment status'}
                                </button>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
