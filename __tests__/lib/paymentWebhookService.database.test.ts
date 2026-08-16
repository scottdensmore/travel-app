/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import {
    PaymentAttemptReconciliationService,
    PaymentWebhookService,
} from '@/lib/paymentWebhookService';
import { prisma } from '@/lib/prisma';
import type {
    PaymentAuthorizationStatus,
    PaymentStateProvider,
} from '@/lib/stripePaymentProvider';
import { lockPaymentIntentForUpdate } from '@/lib/paymentIntentLock';

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

    it('records the first captured state time and preserves it across later events', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'CAPTURED',
        });
        const service = new PaymentWebhookService(fake.value);

        await service.reconcile(event(`evt_${randomUUID()}`, providerIntentId));
        const [first] = await prisma.$queryRaw<Array<{ capturedAt: Date | null }>>`
            SELECT "capturedAt" FROM "PaymentAttempt" WHERE "id" = ${saved.id}
        `;
        await service.reconcile(event(`evt_${randomUUID()}`, providerIntentId));
        const [second] = await prisma.$queryRaw<Array<{ capturedAt: Date | null }>>`
            SELECT "capturedAt" FROM "PaymentAttempt" WHERE "id" = ${saved.id}
        `;

        expect(first.capturedAt).toBeInstanceOf(Date);
        expect(second.capturedAt).toEqual(first.capturedAt);
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

describe('staff reconciliation of one payment attempt', () => {
    it('refreshes the durable attempt from current provider state without inventing a webhook', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED',
        });

        const result = await new PaymentAttemptReconciliationService(fake.value)
            .reconcileAttempt(saved.id);

        expect(result).toMatchObject({
            attemptId: saved.id,
            previousStatus: 'CREATING',
            status: 'AUTHORIZED',
            changed: true,
            updatedAt: expect.any(Date),
        });
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ status: 'AUTHORIZED', updatedAt: result.updatedAt });
        expect(await prisma.paymentWebhookEvent.count({ where: { paymentAttemptId: saved.id } }))
            .toBe(0);
    });

    it('rejects an attempt that has no provider intent before contacting Stripe', async () => {
        const saved = await attempt();
        const fake = provider({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED',
        });

        await expect(new PaymentAttemptReconciliationService(fake.value).reconcileAttempt(saved.id))
            .rejects.toThrow('Payment attempt cannot be reconciled without a provider intent.');
        expect(fake.retrievePaymentState).not.toHaveBeenCalled();
    });

    it('reports an unchanged current provider state without claiming a transition', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        await prisma.paymentAttempt.update({
            where: { id: saved.id },
            data: { status: 'PROCESSING' },
        });
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'PROCESSING',
        });

        await expect(new PaymentAttemptReconciliationService(fake.value).reconcileAttempt(saved.id))
            .resolves.toMatchObject({
                previousStatus: 'PROCESSING',
                status: 'PROCESSING',
                changed: false,
            });
    });

    it('rolls back when provider metadata points at another attempt', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        const fake = provider({
            providerIntentId,
            paymentAttemptId: randomUUID(),
            status: 'AUTHORIZED',
        });

        await expect(new PaymentAttemptReconciliationService(fake.value).reconcileAttempt(saved.id))
            .rejects.toThrow('Stripe PaymentIntent is bound to a different payment attempt.');
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ status: 'CREATING' });
    });

    it('serialises two staff refreshes so an older provider read cannot win last', async () => {
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
        const service = new PaymentAttemptReconciliationService({ retrievePaymentState });

        const first = service.reconcileAttempt(saved.id);
        await started;
        const second = service.reconcileAttempt(saved.id);
        await new Promise(resolve => setTimeout(resolve, 100));

        const callsBeforeRelease = retrievePaymentState.mock.calls.length;
        releaseFirst();
        await Promise.all([first, second]);

        expect(callsBeforeRelease).toBe(1);
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ status: 'CAPTURED' });
    });

    it('refuses a provider binding changed while the staff refresh waits for its lock', async () => {
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const replacementIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const saved = await attempt(providerIntentId);
        let releaseLock!: () => void;
        let lockHeld!: () => void;
        const release = new Promise<void>(resolve => { releaseLock = resolve; });
        const locked = new Promise<void>(resolve => { lockHeld = resolve; });
        const holder = prisma.$transaction(async tx => {
            await lockPaymentIntentForUpdate(tx, providerIntentId);
            lockHeld();
            await release;
        });
        await locked;
        const fake = provider({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED',
        });
        const reconciliation = new PaymentAttemptReconciliationService(fake.value)
            .reconcileAttempt(saved.id);

        try {
            for (let attemptNumber = 0; attemptNumber < 50; attemptNumber += 1) {
                const [waiting] = await prisma.$queryRaw<Array<{ count: number }>>`
                    SELECT count(*)::int AS "count"
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND wait_event = 'advisory'
                `;
                if (waiting.count > 0) break;
                await new Promise(resolve => setTimeout(resolve, 20));
                if (attemptNumber === 49) {
                    throw new Error('Staff reconciliation never waited on its advisory lock.');
                }
            }
            await prisma.paymentAttempt.update({
                where: { id: saved.id },
                data: { providerIntentId: replacementIntentId },
            });
        } finally {
            releaseLock();
            await holder;
        }

        await expect(reconciliation)
            .rejects.toThrow('Payment attempt provider binding changed during reconciliation.');
        expect(fake.retrievePaymentState).not.toHaveBeenCalled();
    });
});
