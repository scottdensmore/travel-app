/** @jest-environment node */

import Stripe from 'stripe';
import { createStripeWebhookVerifier, StripeWebhookVerifier } from '@/lib/stripeWebhook';

const webhookSecret = 'whsec_test_only_webhook_secret';
const stripe = new Stripe('sk_test_only_not_a_real_key');

function signed(payload: string): string {
    return Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
}

function event(type: string, object: Record<string, unknown> = {
    id: 'pi_webhook',
    object: 'payment_intent',
}): string {
    return JSON.stringify({
        id: 'evt_webhook',
        object: 'event',
        type,
        data: { object },
    });
}

describe('StripeWebhookVerifier', () => {
    it('returns safe identifiers from an exactly signed PaymentIntent event', () => {
        const rawBody = event('payment_intent.amount_capturable_updated');

        expect(new StripeWebhookVerifier(stripe, webhookSecret).verify(
            rawBody,
            signed(rawBody),
        )).toEqual({
            eventId: 'evt_webhook',
            eventType: 'payment_intent.amount_capturable_updated',
            providerIntentId: 'pi_webhook',
        });
    });

    it('rejects a body changed after Stripe signed it', () => {
        const rawBody = event('payment_intent.succeeded');

        expect(() => new StripeWebhookVerifier(stripe, webhookSecret).verify(
            `${rawBody} `,
            signed(rawBody),
        )).toThrow();
    });

    it('ignores signed events that cannot change a PaymentIntent state', () => {
        const rawBody = event('charge.succeeded', {
            id: 'ch_ignored',
            object: 'charge',
        });

        expect(new StripeWebhookVerifier(stripe, webhookSecret).verify(
            rawBody,
            signed(rawBody),
        )).toBeNull();
    });

    it('rejects a supported event whose signed object is not a PaymentIntent', () => {
        const rawBody = event('payment_intent.succeeded', {
            id: 'ch_wrong_object',
            object: 'charge',
        });

        expect(() => new StripeWebhookVerifier(stripe, webhookSecret).verify(
            rawBody,
            signed(rawBody),
        )).toThrow('Invalid Stripe PaymentIntent webhook payload.');
    });

    it('refuses to construct a verifier without a webhook signing secret', () => {
        expect(() => createStripeWebhookVerifier({
            STRIPE_SECRET_KEY: 'sk_test_only_not_a_real_key',
            STRIPE_WEBHOOK_SECRET: '   ',
        })).toThrow('Missing required environment variable: STRIPE_WEBHOOK_SECRET');
    });
});
