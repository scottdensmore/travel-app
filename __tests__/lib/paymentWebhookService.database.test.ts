/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { PaymentWebhookService } from '@/lib/paymentWebhookService';
import { prisma } from '@/lib/prisma';
import type {
    PaymentAuthorizationStatus,
    PaymentStateProvider,
} from '@/lib/stripePaymentProvider';

const createdAttemptIds: string[] = [];

async function attempt(providerIntentId: string | null = null) {
    const id = randomUUID();
    createdAttemptIds.push(id);
    return prisma.paymentAttempt.create({
        data: {
            id,
            checkoutId: randomUUID(),
            requestFingerprint: 'a'.repeat(64),
            amountCents: 45_000,
            currency: 'USD',
            providerIntentId,
        },
    });
}

function event(eventId: string, providerIntentId: string) {
    return {
        eventId,
        eventType: 'payment_intent.amount_capturable_updated',
        providerIntentId,
    };
}

function provider(result: {
    providerIntentId: string;
    paymentAttemptId: string | null;
    status: PaymentAuthorizationStatus;
}) {
    const retrievePaymentState = jest.fn().mockResolvedValue(result);
    return {
        value: { retrievePaymentState } satisfies PaymentStateProvider,
        retrievePaymentState,
    };
}

afterAll(async () => {
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: createdAttemptIds } } });
    await prisma.$disconnect();
});

describe('reconciling Stripe PaymentIntent webhooks', () => {
    it('updates the attempt from current provider state and records safe event metadata', async () => {
        const saved = await attempt();
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED',
        });
        const webhook = event(`evt_${randomUUID()}`, providerIntentId);

        await new PaymentWebhookService(fake.value).reconcile(webhook);

        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ providerIntentId, status: 'AUTHORIZED' });
        await expect(prisma.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: webhook.eventId },
        })).resolves.toMatchObject({
            id: webhook.eventId,
            eventType: webhook.eventType,
            providerIntentId,
            paymentAttemptId: saved.id,
        });
    });

    it('acknowledges a duplicate event without retrieving or writing it twice', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'PROCESSING',
        });
        const webhook = event(`evt_${randomUUID()}`, providerIntentId);
        const service = new PaymentWebhookService(fake.value);

        await service.reconcile(webhook);
        await service.reconcile(webhook);

        expect(fake.retrievePaymentState).toHaveBeenCalledTimes(1);
        expect(await prisma.paymentWebhookEvent.count({ where: { id: webhook.eventId } })).toBe(1);
    });

    it('rejects provider state that points at no local payment attempt and records no event', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const fake = provider({
            providerIntentId,
            paymentAttemptId: randomUUID(),
            status: 'AUTHORIZED',
        });
        const webhook = event(`evt_${randomUUID()}`, providerIntentId);

        await expect(new PaymentWebhookService(fake.value).reconcile(webhook))
            .rejects.toThrow('Payment attempt not found for Stripe webhook.');
        expect(await prisma.paymentWebhookEvent.count({ where: { id: webhook.eventId } })).toBe(0);
    });

    it('rejects provider state with no local payment-attempt metadata', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const fake = provider({
            providerIntentId,
            paymentAttemptId: null,
            status: 'AUTHORIZED',
        });
        const webhook = event(`evt_${randomUUID()}`, providerIntentId);

        await expect(new PaymentWebhookService(fake.value).reconcile(webhook))
            .rejects.toThrow('Stripe PaymentIntent has no local payment attempt metadata.');
        expect(await prisma.paymentWebhookEvent.count({ where: { id: webhook.eventId } })).toBe(0);
    });

    it('rejects a signed event whose retrieved PaymentIntent has a different ID', async () => {
        const saved = await attempt();
        const signedIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const fake = provider({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED',
        });
        const webhook = event(`evt_${randomUUID()}`, signedIntentId);

        await expect(new PaymentWebhookService(fake.value).reconcile(webhook))
            .rejects.toThrow('Stripe webhook PaymentIntent did not match the retrieved intent.');
        expect(await prisma.paymentWebhookEvent.count({ where: { id: webhook.eventId } })).toBe(0);
    });

    it('rejects a PaymentIntent already bound to a different local attempt', async () => {
        const boundIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const bound = await attempt(boundIntentId);
        const other = await attempt();
        const fake = provider({
            providerIntentId: boundIntentId,
            paymentAttemptId: other.id,
            status: 'AUTHORIZED',
        });
        const webhook = event(`evt_${randomUUID()}`, boundIntentId);

        await expect(new PaymentWebhookService(fake.value).reconcile(webhook))
            .rejects.toEqual(new Error(
                'Stripe PaymentIntent is bound to a different payment attempt.',
            ));
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: bound.id } }))
            .resolves.toMatchObject({ status: 'CREATING' });
        expect(await prisma.paymentWebhookEvent.count({ where: { id: webhook.eventId } })).toBe(0);
    });

    it('rolls the status update back when recording the event fails', async () => {
        const saved = await attempt();
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED',
        });
        const webhook = {
            ...event(`evt_${randomUUID()}`, providerIntentId),
            eventType: '',
        };

        await expect(new PaymentWebhookService(fake.value).reconcile(webhook))
            .rejects.toThrow('PaymentWebhookEvent_nonempty_event_type');
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ providerIntentId: null, status: 'CREATING' });
        expect(await prisma.paymentWebhookEvent.count({ where: { id: webhook.eventId } })).toBe(0);
    });

    it('serialises different events for one PaymentIntent so older work cannot win last', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        let releaseFirst!: () => void;
        let firstStarted!: () => void;
        const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
        const started = new Promise<void>(resolve => { firstStarted = resolve; });
        let call = 0;
        const retrievePaymentState = jest.fn().mockImplementation(async () => {
            call += 1;
            if (call === 1) {
                firstStarted();
                await firstRelease;
                return {
                    providerIntentId,
                    paymentAttemptId: saved.id,
                    status: 'AUTHORIZED' as const,
                };
            }
            return {
                providerIntentId,
                paymentAttemptId: saved.id,
                status: 'CAPTURED' as const,
            };
        });
        const service = new PaymentWebhookService({ retrievePaymentState });

        const first = service.reconcile(event(`evt_${randomUUID()}`, providerIntentId));
        await started;
        const second = service.reconcile(event(`evt_${randomUUID()}`, providerIntentId));
        await new Promise(resolve => setTimeout(resolve, 100));

        const callsBeforeRelease = retrievePaymentState.mock.calls.length;
        releaseFirst();
        await Promise.all([first, second]);

        expect(callsBeforeRelease).toBe(1);
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ status: 'CAPTURED' });
    });
});
