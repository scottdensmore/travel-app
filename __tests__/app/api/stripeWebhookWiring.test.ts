/** @jest-environment node */

import { POST } from '@/app/api/stripe/webhook/route';
import { PaymentWebhookService } from '@/lib/paymentWebhookService';
import { createStripePaymentProvider } from '@/lib/stripePaymentProvider';
import { createStripeWebhookVerifier } from '@/lib/stripeWebhook';

jest.mock('@/lib/paymentWebhookService', () => {
    const reconcile = jest.fn().mockResolvedValue(undefined);
    return { PaymentWebhookService: jest.fn().mockImplementation(() => ({ reconcile })) };
});

jest.mock('@/lib/stripePaymentProvider', () => ({
    createStripePaymentProvider: jest.fn().mockReturnValue({ provider: 'stripe' }),
}));

jest.mock('@/lib/stripeWebhook', () => ({
    createStripeWebhookVerifier: jest.fn().mockReturnValue({
        verify: jest.fn().mockReturnValue({
            eventId: 'evt_wiring',
            eventType: 'payment_intent.succeeded',
            providerIntentId: 'pi_wiring',
        }),
    }),
}));

const mockedService = jest.mocked(PaymentWebhookService);
const mockedProviderFactory = jest.mocked(createStripePaymentProvider);
const mockedVerifierFactory = jest.mocked(createStripeWebhookVerifier);
const provider = mockedProviderFactory();
const verifier = mockedVerifierFactory();
const reconcile = new (PaymentWebhookService as any)(provider).reconcile as jest.Mock;

beforeEach(() => {
    mockedService.mockClear();
    mockedProviderFactory.mockClear();
    mockedVerifierFactory.mockClear();
    jest.mocked(verifier.verify).mockClear();
    reconcile.mockClear();
});

describe('Stripe webhook production wiring', () => {
    it('constructs the reconciler and sends a relevant verified event through it', async () => {
        const rawBody = '{"id":"evt_wiring"}';
        const response = await POST(new Request('http://localhost/api/stripe/webhook', {
            method: 'POST',
            body: rawBody,
            headers: { 'stripe-signature': 'signed-header' },
        }));

        expect(response.status).toBe(200);
        expect(mockedVerifierFactory).toHaveBeenCalledTimes(1);
        expect(mockedProviderFactory).toHaveBeenCalledTimes(1);
        expect(mockedService).toHaveBeenCalledWith(provider);
        expect(verifier.verify).toHaveBeenCalledWith(rawBody, 'signed-header');
        expect(reconcile).toHaveBeenCalledWith({
            eventId: 'evt_wiring',
            eventType: 'payment_intent.succeeded',
            providerIntentId: 'pi_wiring',
        });
    });
});
