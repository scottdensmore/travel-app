import { NextResponse } from 'next/server';
import { PaymentWebhookService, type PaymentWebhookReconciler } from '@/lib/paymentWebhookService';
import { createStripePaymentProvider } from '@/lib/stripePaymentProvider';
import {
    createStripeWebhookVerifier,
    type PaymentWebhookVerifier,
} from '@/lib/stripeWebhook';

export const runtime = 'nodejs';

interface StripeWebhookDependencies {
    verifier: PaymentWebhookVerifier;
    reconciler: PaymentWebhookReconciler;
}

const invalidSignature = () => NextResponse.json(
    { error: 'Invalid webhook signature.' },
    { status: 400 },
);

export async function handleStripeWebhook(
    request: Request,
    dependencies: StripeWebhookDependencies,
): Promise<Response> {
    const signature = request.headers.get('stripe-signature');
    if (!signature) return invalidSignature();

    const rawBody = await request.text();
    let event;
    try {
        event = dependencies.verifier.verify(rawBody, signature);
    } catch {
        return invalidSignature();
    }

    if (!event) return NextResponse.json({ received: true });

    try {
        await dependencies.reconciler.reconcile(event);
        return NextResponse.json({ received: true });
    } catch {
        console.error({
            message: 'Stripe webhook reconciliation failed.',
            eventId: event.eventId,
            eventType: event.eventType,
        });
        return NextResponse.json(
            { error: 'Webhook processing failed.' },
            { status: 500 },
        );
    }
}

export async function POST(request: Request): Promise<Response> {
    try {
        return await handleStripeWebhook(request, {
            verifier: createStripeWebhookVerifier(),
            reconciler: new PaymentWebhookService(createStripePaymentProvider()),
        });
    } catch {
        console.error({ message: 'Stripe webhook configuration failed.' });
        return NextResponse.json(
            { error: 'Webhook processing failed.' },
            { status: 500 },
        );
    }
}
