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
}

export interface PaymentStateProvider {
    retrievePaymentState(providerIntentId: string): Promise<PaymentState>;
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

export class StripePaymentProvider implements PaymentProvider {
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
    environment: { STRIPE_SECRET_KEY?: string } = {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    },
): StripePaymentProvider {
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
