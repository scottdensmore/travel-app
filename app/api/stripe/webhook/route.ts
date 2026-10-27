import { NextResponse } from 'next/server';
import { PaymentWebhookService } from '@/lib/paymentWebhookService';
import { createStripePaymentProvider } from '@/lib/stripePaymentProvider';
import {
    createStripeWebhookVerifier,
} from '@/lib/stripeWebhook';

import { handleStripeWebhook } from '@/lib/stripeWebhookHandler';

export const runtime = 'nodejs';

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
