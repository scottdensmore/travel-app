/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const createdAttemptIds: string[] = [];

async function attempt() {
    const saved = await prisma.paymentAttempt.create({
        data: {
            id: randomUUID(),
            checkoutId: randomUUID(),
            requestFingerprint: 'a'.repeat(64),
            amountCents: 45_000,
            currency: 'USD',
        },
    });
    createdAttemptIds.push(saved.id);
    return saved;
}

function eventData(paymentAttemptId: string, overrides: Record<string, unknown> = {}) {
    return {
        id: `evt_${randomUUID().replaceAll('-', '')}`,
        eventType: 'payment_intent.processing',
        providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
        paymentAttemptId,
        ...overrides,
    };
}

afterAll(async () => {
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: createdAttemptIds } } });
    await prisma.$disconnect();
});

describe('payment webhook event integrity', () => {
    it.each([
        [
            'empty event type',
            { eventType: '' },
            'PaymentWebhookEvent_nonempty_event_type',
        ],
        [
            'empty provider intent',
            { providerIntentId: '' },
            'PaymentWebhookEvent_nonempty_provider_intent',
        ],
    ] as const)('rejects an %s', async (_name, overrides, constraint) => {
        const saved = await attempt();

        await expect(prisma.paymentWebhookEvent.create({
            data: eventData(saved.id, overrides),
        })).rejects.toThrow(constraint);
    });

    it('rejects an event whose local payment attempt does not exist', async () => {
        await expect(prisma.paymentWebhookEvent.create({
            data: eventData(randomUUID()),
        })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('deletes delivery history with its payment attempt', async () => {
        const saved = await attempt();
        const delivery = await prisma.paymentWebhookEvent.create({
            data: eventData(saved.id),
        });

        await prisma.paymentAttempt.delete({ where: { id: saved.id } });

        await expect(prisma.paymentWebhookEvent.findUnique({ where: { id: delivery.id } }))
            .resolves.toBeNull();
    });
});
