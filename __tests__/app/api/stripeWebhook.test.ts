/** @jest-environment node */

import Stripe from 'stripe';
import { handleStripeWebhook, POST } from '@/app/api/stripe/webhook/route';

function request(body: string, signature?: string): Request {
    return new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        body,
        headers: signature ? { 'stripe-signature': signature } : undefined,
    });
}

function dependencies() {
    return {
        verifier: {
            verify: jest.fn().mockReturnValue({
                eventId: 'evt_route',
                eventType: 'payment_intent.succeeded',
                providerIntentId: 'pi_route',
            }),
        },
        reconciler: { reconcile: jest.fn().mockResolvedValue(undefined) },
    };
}

describe('Stripe payment webhook route', () => {
    it('wires the production route to Stripe signature verification', async () => {
        const priorKey = process.env.STRIPE_SECRET_KEY;
        const priorWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const webhookSecret = 'whsec_route_test_secret';
        const rawBody = JSON.stringify({
            id: 'evt_ignored',
            object: 'event',
            type: 'charge.succeeded',
            data: { object: { id: 'ch_ignored', object: 'charge' } },
        });
        process.env.STRIPE_SECRET_KEY = 'sk_test_only_not_a_real_key';
        process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

        try {
            const response = await POST(request(
                rawBody,
                Stripe.webhooks.generateTestHeaderString({
                    payload: rawBody,
                    secret: webhookSecret,
                }),
            ));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ received: true });

            const invalid = await POST(request(rawBody, 'not-a-stripe-signature'));
            expect(invalid.status).toBe(400);
        } finally {
            if (priorKey === undefined) delete process.env.STRIPE_SECRET_KEY;
            else process.env.STRIPE_SECRET_KEY = priorKey;
            if (priorWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
            else process.env.STRIPE_WEBHOOK_SECRET = priorWebhookSecret;
        }
    });

    it('verifies the untouched request body before reconciling the event', async () => {
        const rawBody = '{\n  "id": "evt_route"\n}\n';
        const deps = dependencies();

        const response = await handleStripeWebhook(request(rawBody, 'signed-header'), deps);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ received: true });
        expect(deps.verifier.verify).toHaveBeenCalledWith(rawBody, 'signed-header');
        expect(deps.reconciler.reconcile).toHaveBeenCalledWith({
            eventId: 'evt_route',
            eventType: 'payment_intent.succeeded',
            providerIntentId: 'pi_route',
        });
    });

    it('rejects a request with no Stripe signature without reading it as an event', async () => {
        const deps = dependencies();

        const response = await handleStripeWebhook(request('{}'), deps);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid webhook signature.' });
        expect(deps.verifier.verify).not.toHaveBeenCalled();
        expect(deps.reconciler.reconcile).not.toHaveBeenCalled();
    });

    it('returns the same customer-safe response for an invalid signature', async () => {
        const deps = dependencies();
        deps.verifier.verify.mockImplementation(() => {
            throw new Error('signature included sensitive raw payload');
        });

        const response = await handleStripeWebhook(request('{}', 'invalid'), deps);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid webhook signature.' });
        expect(deps.reconciler.reconcile).not.toHaveBeenCalled();
    });

    it('acknowledges an irrelevant signed event without reconciling it', async () => {
        const deps = dependencies();
        deps.verifier.verify.mockReturnValue(null);

        const response = await handleStripeWebhook(request('{}', 'valid'), deps);

        expect(response.status).toBe(200);
        expect(deps.reconciler.reconcile).not.toHaveBeenCalled();
    });

    it('returns a retryable error and logs no provider error or request data', async () => {
        const deps = dependencies();
        deps.reconciler.reconcile.mockRejectedValue(
            new Error('cardholder-secret@example.com pi_secret_value'),
        );
        const error = jest.spyOn(console, 'error').mockImplementation();

        try {
            const response = await handleStripeWebhook(
                request('{"private":"body-value"}', 'valid'),
                deps,
            );

            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toEqual({ error: 'Webhook processing failed.' });
            expect(error).toHaveBeenCalledWith({
                message: 'Stripe webhook reconciliation failed.',
                eventId: 'evt_route',
                eventType: 'payment_intent.succeeded',
            });
            expect(JSON.stringify(error.mock.calls)).not.toMatch(
                /cardholder-secret|pi_secret_value|body-value/,
            );
        } finally {
            error.mockRestore();
        }
    });
});
