import Stripe from 'stripe';

export type PaymentAuthorizationStatus =
    | 'REQUIRES_PAYMENT_METHOD'
    | 'REQUIRES_CONFIRMATION'
    | 'REQUIRES_ACTION'
    | 'PROCESSING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'CANCELLED';

export interface PaymentAuthorization {
    providerIntentId: string;
    clientSecret: string;
    status: PaymentAuthorizationStatus;
}

export interface PaymentState {
    providerIntentId: string;
    paymentAttemptId: string | null;
    status: PaymentAuthorizationStatus;
}

export interface PaymentProvider {
    createAuthorization(input: {
        attemptId: string;
        amountCents: number;
        currency: string;
    }): Promise<PaymentAuthorization>;
    retrieveAuthorization(providerIntentId: string): Promise<PaymentAuthorization>;
    captureAuthorization(input: {
        providerIntentId: string;
        attemptId: string;
        amountCents: number;
    }): Promise<PaymentAuthorization>;
    cancelAuthorization(input: {
        providerIntentId: string;
        attemptId: string;
    }): Promise<PaymentAuthorization>;
}

export interface PaymentStateProvider {
    retrievePaymentState(providerIntentId: string): Promise<PaymentState>;
}

export type PaymentRefundStatus =
    | 'PENDING'
    | 'REQUIRES_ACTION'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED';

export interface PaymentRefundState {
    providerRefundId: string;
    paymentRefundId: string | null;
    refundAttemptId: string | null;
    status: PaymentRefundStatus;
}

export interface RefundProvider {
    createRefund(input: {
        refundId: string;
        refundAttemptId: string;
        providerIntentId: string;
        amountCents: number;
    }): Promise<PaymentRefundState>;
    retrieveRefund(providerRefundId: string): Promise<PaymentRefundState>;
    findRefund(input: {
        refundId: string;
        refundAttemptId: string;
        providerIntentId: string;
    }): Promise<PaymentRefundState | null>;
}

interface StripeEnvironment {
    STRIPE_SECRET_KEY?: string;
    STRIPE_PUBLISHABLE_KEY?: string;
    E2E_STRIPE_MODE?: string;
    DATABASE_IS_DISPOSABLE?: string;
    NODE_ENV?: string;
}

interface PlaywrightIntent {
    attemptId: string;
    amountCents: number;
    currency: string;
    retrievalCount: number;
    status: PaymentAuthorizationStatus;
}

interface PlaywrightRefund {
    refundId: string;
    refundAttemptId: string;
    providerIntentId: string;
    amountCents: number;
    status: PaymentRefundStatus;
}

const PLAYWRIGHT_PUBLISHABLE_KEY = 'pk_test_mona_playwright';
const globalForPlaywrightStripe = globalThis as typeof globalThis & {
    monaPlaywrightStripeIntents?: Map<string, PlaywrightIntent>;
    monaPlaywrightStripeRefunds?: Map<string, PlaywrightRefund>;
};

function requirePlaywrightEnvironment(environment: StripeEnvironment): boolean {
    if (!environment.E2E_STRIPE_MODE) return false;
    if (environment.E2E_STRIPE_MODE !== 'playwright') {
        throw new Error('E2E_STRIPE_MODE must be playwright when it is set.');
    }
    if (environment.NODE_ENV === 'production') {
        throw new Error('The Playwright Stripe provider is forbidden in production.');
    }
    if (environment.DATABASE_IS_DISPOSABLE !== 'true') {
        throw new Error('The Playwright Stripe provider requires DATABASE_IS_DISPOSABLE=true.');
    }
    return true;
}

class PlaywrightStripePaymentProvider implements PaymentProvider, PaymentStateProvider, RefundProvider {
    private readonly intents = globalForPlaywrightStripe.monaPlaywrightStripeIntents
        ??= new Map<string, PlaywrightIntent>();
    private readonly refunds = globalForPlaywrightStripe.monaPlaywrightStripeRefunds
        ??= new Map<string, PlaywrightRefund>();

    async createAuthorization(input: {
        attemptId: string;
        amountCents: number;
        currency: string;
    }): Promise<PaymentAuthorization> {
        const providerIntentId = `pi_playwright_${input.attemptId}`;
        this.intents.set(providerIntentId, {
            ...input,
            retrievalCount: 0,
            status: 'REQUIRES_PAYMENT_METHOD',
        });
        return {
            providerIntentId,
            clientSecret: `${providerIntentId}_secret_for_e2e_only`,
            status: 'REQUIRES_PAYMENT_METHOD',
        };
    }

    async retrieveAuthorization(providerIntentId: string): Promise<PaymentAuthorization> {
        const intent = this.intents.get(providerIntentId);
        if (!intent) throw new Error('Playwright payment session was not found.');
        intent.retrievalCount += 1;
        if (intent.status === 'REQUIRES_PAYMENT_METHOD' && intent.retrievalCount > 1) {
            intent.status = 'AUTHORIZED';
        }
        return {
            providerIntentId,
            clientSecret: `${providerIntentId}_secret_for_e2e_only`,
            // Checkout preparation performs the first read. The browser's
            // guarded test button then causes a second server read, modelling
            // Stripe changing requires_payment_method to requires_capture.
            status: intent.status,
        };
    }

    async captureAuthorization(input: {
        providerIntentId: string;
        attemptId: string;
        amountCents: number;
    }): Promise<PaymentAuthorization> {
        const intent = this.intents.get(input.providerIntentId);
        if (!intent || intent.attemptId !== input.attemptId) {
            throw new Error('Playwright payment session was not found.');
        }
        if (intent.amountCents !== input.amountCents || intent.status !== 'AUTHORIZED') {
            throw new Error('Playwright payment session is not capturable.');
        }
        intent.status = 'CAPTURED';
        return {
            providerIntentId: input.providerIntentId,
            clientSecret: `${input.providerIntentId}_secret_for_e2e_only`,
            status: intent.status,
        };
    }

    async cancelAuthorization(input: {
        providerIntentId: string;
        attemptId: string;
    }): Promise<PaymentAuthorization> {
        const intent = this.intents.get(input.providerIntentId);
        if (!intent || intent.attemptId !== input.attemptId) {
            throw new Error('Playwright payment session was not found.');
        }
        if (intent.status !== 'CAPTURED') intent.status = 'CANCELLED';
        return {
            providerIntentId: input.providerIntentId,
            clientSecret: `${input.providerIntentId}_secret_for_e2e_only`,
            status: intent.status,
        };
    }

    async retrievePaymentState(providerIntentId: string): Promise<PaymentState> {
        const intent = this.intents.get(providerIntentId);
        if (!intent) throw new Error('Playwright payment session was not found.');
        return {
            providerIntentId,
            paymentAttemptId: intent.attemptId,
            status: intent.status,
        };
    }

    async createRefund(input: {
        refundId: string;
        refundAttemptId: string;
        providerIntentId: string;
        amountCents: number;
    }): Promise<PaymentRefundState> {
        const providerRefundId = `re_playwright_${input.refundAttemptId}`;
        if (!this.intents.has(input.providerIntentId)) {
            throw new Error('Playwright payment session was not found.');
        }
        this.refunds.set(providerRefundId, { ...input, status: 'SUCCEEDED' });
        return {
            providerRefundId,
            paymentRefundId: input.refundId,
            refundAttemptId: input.refundAttemptId,
            status: 'SUCCEEDED',
        };
    }

    async retrieveRefund(providerRefundId: string): Promise<PaymentRefundState> {
        const refund = this.refunds.get(providerRefundId);
        if (!refund) throw new Error('Playwright refund was not found.');
        return {
            providerRefundId,
            paymentRefundId: refund.refundId,
            refundAttemptId: refund.refundAttemptId,
            status: refund.status,
        };
    }

    async findRefund(input: {
        refundId: string;
        refundAttemptId: string;
        providerIntentId: string;
    }): Promise<PaymentRefundState | null> {
        for (const [providerRefundId, refund] of this.refunds) {
            if (
                refund.refundId === input.refundId
                && refund.refundAttemptId === input.refundAttemptId
                && refund.providerIntentId === input.providerIntentId
            ) {
                return {
                    providerRefundId,
                    paymentRefundId: refund.refundId,
                    refundAttemptId: refund.refundAttemptId,
                    status: refund.status,
                };
            }
        }
        return null;
    }
}

const PAYMENT_STATUS: Record<Stripe.PaymentIntent.Status, PaymentAuthorizationStatus> = {
    requires_payment_method: 'REQUIRES_PAYMENT_METHOD',
    requires_confirmation: 'REQUIRES_CONFIRMATION',
    requires_action: 'REQUIRES_ACTION',
    processing: 'PROCESSING',
    requires_capture: 'AUTHORIZED',
    succeeded: 'CAPTURED',
    canceled: 'CANCELLED',
};

const REFUND_STATUS: Record<NonNullable<Stripe.Refund['status']>, PaymentRefundStatus> = {
    pending: 'PENDING',
    requires_action: 'REQUIRES_ACTION',
    succeeded: 'SUCCEEDED',
    failed: 'FAILED',
    canceled: 'CANCELLED',
};

function paymentRefund(refund: Stripe.Refund): PaymentRefundState {
    if (!refund.status) throw new Error('Stripe did not return a refund status.');
    return {
        providerRefundId: refund.id,
        paymentRefundId: refund.metadata?.paymentRefundId || null,
        refundAttemptId: refund.metadata?.refundAttemptId || null,
        status: REFUND_STATUS[refund.status],
    };
}

function paymentAuthorization(intent: Stripe.PaymentIntent): PaymentAuthorization {
    if (!intent.client_secret) {
        throw new Error('Stripe did not return a client secret for the payment session.');
    }

    return {
        providerIntentId: intent.id,
        clientSecret: intent.client_secret,
        status: PAYMENT_STATUS[intent.status],
    };
}

export class StripePaymentProvider implements PaymentProvider, RefundProvider {
    constructor(private readonly stripe: Stripe) {}

    async createAuthorization(input: {
        attemptId: string;
        amountCents: number;
        currency: string;
    }): Promise<PaymentAuthorization> {
        const intent = await this.stripe.paymentIntents.create({
            amount: input.amountCents,
            currency: input.currency.toLowerCase(),
            capture_method: 'manual',
            automatic_payment_methods: { enabled: true },
            metadata: { paymentAttemptId: input.attemptId },
        }, { idempotencyKey: `payment-attempt:${input.attemptId}` });

        return paymentAuthorization(intent);
    }

    async retrieveAuthorization(providerIntentId: string): Promise<PaymentAuthorization> {
        return paymentAuthorization(await this.stripe.paymentIntents.retrieve(providerIntentId));
    }

    async captureAuthorization(input: {
        providerIntentId: string;
        attemptId: string;
        amountCents: number;
    }): Promise<PaymentAuthorization> {
        return paymentAuthorization(await this.stripe.paymentIntents.capture(
            input.providerIntentId,
            { amount_to_capture: input.amountCents },
            { idempotencyKey: `payment-capture:${input.attemptId}` },
        ));
    }

    async cancelAuthorization(input: {
        providerIntentId: string;
        attemptId: string;
    }): Promise<PaymentAuthorization> {
        return paymentAuthorization(await this.stripe.paymentIntents.cancel(
            input.providerIntentId,
            { cancellation_reason: 'abandoned' },
            { idempotencyKey: `payment-cancel:${input.attemptId}` },
        ));
    }

    async createRefund(input: {
        refundId: string;
        refundAttemptId: string;
        providerIntentId: string;
        amountCents: number;
    }): Promise<PaymentRefundState> {
        return paymentRefund(await this.stripe.refunds.create({
            payment_intent: input.providerIntentId,
            amount: input.amountCents,
            reason: 'requested_by_customer',
            metadata: {
                paymentRefundId: input.refundId,
                refundAttemptId: input.refundAttemptId,
            },
        }, { idempotencyKey: `payment-refund:${input.refundAttemptId}` }));
    }

    async retrieveRefund(providerRefundId: string): Promise<PaymentRefundState> {
        return paymentRefund(await this.stripe.refunds.retrieve(providerRefundId));
    }

    async findRefund(input: {
        refundId: string;
        refundAttemptId: string;
        providerIntentId: string;
    }): Promise<PaymentRefundState | null> {
        for await (const refund of this.stripe.refunds.list({
            payment_intent: input.providerIntentId,
        })) {
            if (
                refund.metadata?.paymentRefundId === input.refundId
                && refund.metadata?.refundAttemptId === input.refundAttemptId
            ) return paymentRefund(refund);
        }
        return null;
    }

    async retrievePaymentState(providerIntentId: string): Promise<PaymentState> {
        const intent = await this.stripe.paymentIntents.retrieve(providerIntentId);
        return {
            providerIntentId: intent.id,
            paymentAttemptId: intent.metadata.paymentAttemptId || null,
            status: PAYMENT_STATUS[intent.status],
        };
    }
}

export function createStripePaymentProvider(
    environment: StripeEnvironment = {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        E2E_STRIPE_MODE: process.env.E2E_STRIPE_MODE,
        DATABASE_IS_DISPOSABLE: process.env.DATABASE_IS_DISPOSABLE,
        NODE_ENV: process.env.NODE_ENV,
    },
): PaymentProvider & PaymentStateProvider & RefundProvider {
    if (requirePlaywrightEnvironment(environment)) {
        return new PlaywrightStripePaymentProvider();
    }
    return new StripePaymentProvider(createStripeClient(environment));
}

export function createStripeClient(
    environment: { STRIPE_SECRET_KEY?: string } = {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    },
): Stripe {
    const secretKey = environment.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
        throw new Error('Missing required environment variable: STRIPE_SECRET_KEY');
    }
    return new Stripe(secretKey);
}

export function getStripePublishableKey(
    environment: StripeEnvironment = {
        STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
        E2E_STRIPE_MODE: process.env.E2E_STRIPE_MODE,
        DATABASE_IS_DISPOSABLE: process.env.DATABASE_IS_DISPOSABLE,
        NODE_ENV: process.env.NODE_ENV,
    },
): string {
    if (requirePlaywrightEnvironment(environment)) return PLAYWRIGHT_PUBLISHABLE_KEY;
    const publishableKey = environment.STRIPE_PUBLISHABLE_KEY?.trim();
    if (!publishableKey) {
        throw new Error('Missing required environment variable: STRIPE_PUBLISHABLE_KEY');
    }
    if (
        publishableKey === PLAYWRIGHT_PUBLISHABLE_KEY
        || (!publishableKey.startsWith('pk_test_') && !publishableKey.startsWith('pk_live_'))
    ) {
        throw new Error('STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key.');
    }
    return publishableKey;
}
