/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const created = {
    attemptIds: [] as string[],
    userIds: [] as string[],
};

async function createUser() {
    const id = randomUUID();
    const user = await prisma.user.create({
        data: { email: `payment-integrity-${id}@example.com` },
    });
    created.userIds.push(user.id);
    return user;
}

function attemptData(userId: string, overrides: Record<string, unknown> = {}) {
    return {
        id: randomUUID(),
        checkoutId: randomUUID(),
        userId,
        requestFingerprint: 'a'.repeat(64),
        amountCents: 35_000,
        currency: 'USD',
        ...overrides,
    };
}

afterAll(async () => {
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: created.attemptIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('payment attempt integrity', () => {
    it('accepts a positive amount, ISO currency, and SHA-256 fingerprint', async () => {
        const user = await createUser();
        const attempt = await prisma.paymentAttempt.create({ data: attemptData(user.id) });
        created.attemptIds.push(attempt.id);

        expect(attempt).toMatchObject({
            amountCents: 35_000,
            currency: 'USD',
            requestFingerprint: 'a'.repeat(64),
        });
    });

    it.each([
        ['non-positive amount', { amountCents: 0 }, 'PaymentAttempt_positive_amount'],
        ['non-ISO currency', { currency: 'usd' }, 'PaymentAttempt_iso_currency'],
        [
            'non-SHA-256 fingerprint',
            { requestFingerprint: 'not-a-sha256' },
            'PaymentAttempt_sha256_fingerprint',
        ],
    ] as const)('rejects a %s', async (_name, overrides, constraint) => {
        const user = await createUser();

        await expect(prisma.paymentAttempt.create({
            data: attemptData(user.id, overrides),
        })).rejects.toThrow(constraint);
    });

    it('keeps one local owner for each provider intent', async () => {
        const user = await createUser();
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const first = await prisma.paymentAttempt.create({
            data: attemptData(user.id, { providerIntentId }),
        });
        created.attemptIds.push(first.id);

        await expect(prisma.paymentAttempt.create({
            data: attemptData(user.id, { providerIntentId }),
        })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('retains reconciliation metadata after its user is deleted', async () => {
        const user = await createUser();
        const attempt = await prisma.paymentAttempt.create({
            data: attemptData(user.id, {
                providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            }),
        });
        created.attemptIds.push(attempt.id);

        await prisma.user.delete({ where: { id: user.id } });

        await expect(prisma.paymentAttempt.findUniqueOrThrow({
            where: { id: attempt.id },
        })).resolves.toMatchObject({
            id: attempt.id,
            userId: null,
            providerIntentId: attempt.providerIntentId,
        });
    });
});
