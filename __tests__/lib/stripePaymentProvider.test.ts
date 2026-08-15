/** @jest-environment node */

import {
    createStripePaymentProvider,
    getStripePublishableKey,
    StripePaymentProvider,
} from '@/lib/stripePaymentProvider';

describe('StripePaymentProvider', () => {
    it('creates a manual-capture PaymentIntent with a stable idempotency key', async () => {
        const create = jest.fn().mockResolvedValue({
            id: 'pi_authorization',
            client_secret: 'pi_authorization_secret_safe_for_elements',
            status: 'requires_payment_method',
        });
        const provider = new StripePaymentProvider({
            paymentIntents: { create, retrieve: jest.fn() },
        } as never);

        await expect(provider.createAuthorization({
            attemptId: 'attempt-123',
            amountCents: 45_000,
            currency: 'USD',
        })).resolves.toEqual({
            providerIntentId: 'pi_authorization',
            clientSecret: 'pi_authorization_secret_safe_for_elements',
            status: 'REQUIRES_PAYMENT_METHOD',
        });
        expect(create).toHaveBeenCalledWith({
            amount: 45_000,
            currency: 'usd',
            capture_method: 'manual',
            automatic_payment_methods: { enabled: true },
            metadata: { paymentAttemptId: 'attempt-123' },
        }, { idempotencyKey: 'payment-attempt:attempt-123' });
    });

    it('retrieves an existing PaymentIntent instead of creating another one', async () => {
        const retrieve = jest.fn().mockResolvedValue({
            id: 'pi_existing',
            client_secret: 'pi_existing_secret_safe_for_elements',
            status: 'requires_capture',
        });
        const create = jest.fn();
        const provider = new StripePaymentProvider({
            paymentIntents: { create, retrieve },
        } as never);

        await expect(provider.retrieveAuthorization('pi_existing')).resolves.toEqual({
            providerIntentId: 'pi_existing',
            clientSecret: 'pi_existing_secret_safe_for_elements',
            status: 'AUTHORIZED',
        });
        expect(retrieve).toHaveBeenCalledWith('pi_existing');
        expect(create).not.toHaveBeenCalled();
    });

    it('retrieves current reconciliation state without returning the client secret', async () => {
        const retrieve = jest.fn().mockResolvedValue({
            id: 'pi_current',
            client_secret: 'pi_current_secret_must_not_escape',
            status: 'requires_capture',
            metadata: { paymentAttemptId: 'attempt-current' },
        });
        const provider = new StripePaymentProvider({
            paymentIntents: { create: jest.fn(), retrieve },
        } as never);

        const state = await provider.retrievePaymentState('pi_current');
        expect(state).toEqual({
            providerIntentId: 'pi_current',
            paymentAttemptId: 'attempt-current',
            status: 'AUTHORIZED',
        });
        expect(JSON.stringify(state))
            .not.toContain('pi_current_secret_must_not_escape');
        expect(retrieve).toHaveBeenCalledWith('pi_current');
    });

    it('refuses to construct a provider without the server secret', () => {
        expect(() => createStripePaymentProvider({ STRIPE_SECRET_KEY: '   ' })).toThrow(
            'Missing required environment variable: STRIPE_SECRET_KEY',
        );
    });

    it('uses a deterministic provider only for a disposable non-production Playwright database', async () => {
        const environment = {
            E2E_STRIPE_MODE: 'playwright',
            DATABASE_IS_DISPOSABLE: 'true',
            NODE_ENV: 'development',
        };
        const provider = createStripePaymentProvider(environment);

        const created = await provider.createAuthorization({
            attemptId: 'attempt-playwright',
            amountCents: 10_000,
            currency: 'USD',
        });
        await expect(provider.retrieveAuthorization(created.providerIntentId)).resolves.toMatchObject({
            status: 'REQUIRES_PAYMENT_METHOD',
        });
        await expect(provider.retrieveAuthorization(created.providerIntentId)).resolves.toMatchObject({
            status: 'AUTHORIZED',
        });
        expect(getStripePublishableKey(environment)).toBe('pk_test_mona_playwright');
    });

    it('refuses the Playwright provider in production even with a disposable marker', () => {
        const environment = {
            E2E_STRIPE_MODE: 'playwright',
            DATABASE_IS_DISPOSABLE: 'true',
            NODE_ENV: 'production',
        };

        expect(() => createStripePaymentProvider(environment)).toThrow(
            'The Playwright Stripe provider is forbidden in production.',
        );
        expect(() => getStripePublishableKey(environment)).toThrow(
            'The Playwright Stripe provider is forbidden in production.',
        );
    });

    it('refuses the Playwright provider against a database not marked disposable', () => {
        const environment = {
            E2E_STRIPE_MODE: 'playwright',
            DATABASE_IS_DISPOSABLE: 'false',
            NODE_ENV: 'development',
        };

        expect(() => createStripePaymentProvider(environment)).toThrow(
            'The Playwright Stripe provider requires DATABASE_IS_DISPOSABLE=true.',
        );
        expect(() => getStripePublishableKey(environment)).toThrow(
            'The Playwright Stripe provider requires DATABASE_IS_DISPOSABLE=true.',
        );
    });

    it('refuses an unsupported E2E Stripe provider mode', () => {
        const environment = {
            E2E_STRIPE_MODE: 'fake-production',
            DATABASE_IS_DISPOSABLE: 'true',
            NODE_ENV: 'development',
        };

        expect(() => createStripePaymentProvider(environment)).toThrow(
            'E2E_STRIPE_MODE must be playwright when it is set.',
        );
        expect(() => getStripePublishableKey(environment)).toThrow(
            'E2E_STRIPE_MODE must be playwright when it is set.',
        );
    });

    it('returns only a trimmed Stripe publishable key for hosted fields', () => {
        expect(getStripePublishableKey({
            STRIPE_PUBLISHABLE_KEY: '  pk_test_public_browser_key  ',
        })).toBe('pk_test_public_browser_key');
    });

    it.each([
        ['', 'Missing required environment variable: STRIPE_PUBLISHABLE_KEY'],
        ['sk_test_server_secret', 'STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key.'],
        ['pk_test_mona_playwright', 'STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key.'],
    ])('refuses an unsafe browser key value', (value, expectedMessage) => {
        expect(() => getStripePublishableKey({ STRIPE_PUBLISHABLE_KEY: value }))
            .toThrow(expectedMessage);
    });

    it('refuses a PaymentIntent that cannot be confirmed by Stripe Elements', async () => {
        const provider = new StripePaymentProvider({
            paymentIntents: {
                create: jest.fn().mockResolvedValue({
                    id: 'pi_without_secret',
                    client_secret: null,
                    status: 'requires_payment_method',
                }),
                retrieve: jest.fn(),
            },
        } as never);

        await expect(provider.createAuthorization({
            attemptId: 'attempt-123',
            amountCents: 45_000,
            currency: 'USD',
        })).rejects.toThrow('Stripe did not return a client secret for the payment session.');
    });

    it.each([
        ['requires_confirmation', 'REQUIRES_CONFIRMATION'],
        ['requires_action', 'REQUIRES_ACTION'],
        ['processing', 'PROCESSING'],
        ['succeeded', 'CAPTURED'],
        ['canceled', 'CANCELLED'],
    ] as const)('maps Stripe %s to %s', async (stripeStatus, expectedStatus) => {
        const provider = new StripePaymentProvider({
            paymentIntents: {
                create: jest.fn(),
                retrieve: jest.fn().mockResolvedValue({
                    id: 'pi_status',
                    client_secret: 'pi_status_secret_for_elements',
                    status: stripeStatus,
                }),
            },
        } as never);

        await expect(provider.retrieveAuthorization('pi_status')).resolves.toMatchObject({
            status: expectedStatus,
        });
    });
});
