import type Stripe from 'stripe';
import { createStripeClient } from '@/lib/stripePaymentProvider';

const PAYMENT_INTENT_EVENTS = new Set([
    'payment_intent.created',
    'payment_intent.payment_failed',
    'payment_intent.requires_action',
    'payment_intent.processing',
    'payment_intent.amount_capturable_updated',
    'payment_intent.succeeded',
    'payment_intent.canceled',
]);

export interface VerifiedPaymentWebhookEvent {
    eventId: string;
    eventType: string;
    providerIntentId: string;
}

export interface PaymentWebhookVerifier {
    verify(rawBody: string, signature: string): VerifiedPaymentWebhookEvent | null;
}

export class StripeWebhookVerifier implements PaymentWebhookVerifier {
    constructor(
        private readonly stripe: Stripe,
        private readonly webhookSecret: string,
    ) {}

    verify(rawBody: string, signature: string): VerifiedPaymentWebhookEvent | null {
        const event = this.stripe.webhooks.constructEvent(
            rawBody,
            signature,
            this.webhookSecret,
        );

        if (!PAYMENT_INTENT_EVENTS.has(event.type)) return null;

        const object = event.data.object;
        if (object.object !== 'payment_intent' || typeof object.id !== 'string') {
            throw new Error('Invalid Stripe PaymentIntent webhook payload.');
        }

        return {
            eventId: event.id,
            eventType: event.type,
            providerIntentId: object.id,
        };
    }
}

export function createStripeWebhookVerifier(
    environment: {
        STRIPE_SECRET_KEY?: string;
        STRIPE_WEBHOOK_SECRET?: string;
    } = {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
): StripeWebhookVerifier {
    const webhookSecret = environment.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
        throw new Error('Missing required environment variable: STRIPE_WEBHOOK_SECRET');
    }

    return new StripeWebhookVerifier(createStripeClient(environment), webhookSecret);
}
