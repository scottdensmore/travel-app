'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Elements,
    PaymentElement,
    useElements,
    useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

interface CheckoutPaymentFormProps {
    publishableKey: string;
    clientSecret: string;
    amountDisplay: string;
    disabled: boolean;
    submitting: boolean;
    onConfirmed: () => Promise<void> | void;
}

type HostedPaymentFieldsProps = Pick<
    CheckoutPaymentFormProps,
    'amountDisplay' | 'disabled' | 'submitting' | 'onConfirmed'
>;

const PLAYWRIGHT_PUBLISHABLE_KEY = 'pk_test_mona_playwright';

function PlaywrightPaymentFields({
    amountDisplay,
    disabled,
    submitting,
    onConfirmed,
}: HostedPaymentFieldsProps) {
    const [confirming, setConfirming] = useState(false);
    const busy = confirming || submitting;

    return (
        <form
            onSubmit={async event => {
                event.preventDefault();
                if (disabled || busy) return;
                setConfirming(true);
                try {
                    await onConfirmed();
                } finally {
                    setConfirming(false);
                }
            }}
        >
            <div
                role="group"
                aria-label="Playwright hosted payment fields"
                style={{ border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '1rem' }}
            >
                Automated checkout uses the guarded Stripe provider boundary.
            </div>
            <button
                type="submit"
                disabled={disabled || busy}
                aria-busy={busy}
                aria-describedby="seat-hold-timer"
                style={{
                    width: '100%',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    cursor: disabled || busy ? 'not-allowed' : 'pointer',
                    opacity: disabled || busy ? 0.65 : 1,
                    fontWeight: 'bold',
                    marginTop: '1rem',
                }}
            >
                {busy ? 'Confirming booking…' : `Authorize ${amountDisplay} and confirm booking`}
            </button>
        </form>
    );
}

function HostedPaymentFields({
    amountDisplay,
    disabled,
    submitting,
    onConfirmed,
}: HostedPaymentFieldsProps) {
    const stripe = useStripe();
    const elements = useElements();
    const [elementReady, setElementReady] = useState(false);
    const [elementLoadFailed, setElementLoadFailed] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const errorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (paymentError) errorRef.current?.focus();
    }, [paymentError]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!stripe || !elements || !elementReady || disabled || submitting || confirming) return;

        setConfirming(true);
        setPaymentError(null);
        try {
            const result = await stripe.confirmPayment({
                elements,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required',
            });
            if (result.error) {
                setPaymentError(result.error.message ?? 'Stripe could not authorize this payment.');
                return;
            }

            // The browser result is deliberately not trusted as authority.
            // The parent re-reads the PaymentIntent through the authenticated
            // server action before it asks the server to create a booking.
            setConfirming(false);
            await onConfirmed();
        } catch {
            setPaymentError('We could not confirm the payment just now. Please try again.');
        } finally {
            setConfirming(false);
        }
    };

    const busy = confirming || submitting;
    const unavailable = disabled || busy || !stripe || !elements || !elementReady || elementLoadFailed;

    return (
        <form onSubmit={handleSubmit}>
            <PaymentElement
                onReady={() => setElementReady(true)}
                onLoadError={() => {
                    setElementLoadFailed(true);
                    setPaymentError('Stripe’s secure payment fields could not load. Please try again.');
                }}
            />
            {!elementReady && !elementLoadFailed && (
                <p role="status" style={{ color: 'rgba(255,255,255,0.7)', margin: '0.75rem 0' }}>
                    Loading secure payment fields…
                </p>
            )}
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.85rem', margin: '1rem 0' }}>
                Your payment details are encrypted and sent directly to Stripe. Mona Airways never receives your card number or security code.
            </p>
            {paymentError && (
                <div
                    ref={errorRef}
                    role="alert"
                    tabIndex={-1}
                    className="booking-checkout-error"
                    style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        color: '#fca5a5',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius: '8px',
                        padding: '0.75rem',
                        marginBottom: '1rem',
                    }}
                >
                    {paymentError}
                </div>
            )}
            <button
                type="submit"
                disabled={unavailable}
                aria-busy={busy}
                aria-describedby="seat-hold-timer"
                style={{
                    width: '100%',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    cursor: unavailable ? 'not-allowed' : 'pointer',
                    opacity: unavailable ? 0.65 : 1,
                    fontWeight: 'bold',
                }}
            >
                {confirming
                    ? 'Authorizing payment…'
                    : submitting
                        ? 'Confirming booking…'
                        : `Authorize ${amountDisplay} and confirm booking`}
            </button>
            {busy && (
                <p role="status" style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', margin: '0.75rem 0 0' }}>
                    {confirming
                        ? 'Authorizing your payment securely with Stripe.'
                        : 'Confirming booking and checking availability.'}
                </p>
            )}
        </form>
    );
}

export default function CheckoutPaymentForm({
    publishableKey,
    clientSecret,
    ...formProps
}: CheckoutPaymentFormProps) {
    if (publishableKey === PLAYWRIGHT_PUBLISHABLE_KEY) {
        return <PlaywrightPaymentFields {...formProps} />;
    }

    return (
        <StripeElementsPaymentForm
            publishableKey={publishableKey}
            clientSecret={clientSecret}
            {...formProps}
        />
    );
}

function StripeElementsPaymentForm({
    publishableKey,
    clientSecret,
    ...formProps
}: CheckoutPaymentFormProps) {
    const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
    const options = useMemo(() => ({
        clientSecret,
        appearance: {
            theme: 'night' as const,
            variables: {
                colorPrimary: '#8b5cf6',
                colorBackground: '#17152f',
                colorText: '#ffffff',
                colorDanger: '#fca5a5',
                borderRadius: '8px',
            },
        },
    }), [clientSecret]);

    return (
        <Elements stripe={stripe} options={options}>
            <HostedPaymentFields {...formProps} />
        </Elements>
    );
}
