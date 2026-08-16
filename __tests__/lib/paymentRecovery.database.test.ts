/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import type { PaymentAttemptStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { listStalePaymentAttempts } from '@/lib/paymentRecovery';

const createdAttemptIds: string[] = [];

async function createAttempt(input: {
    providerIntentId: string | null;
    status?: PaymentAttemptStatus;
    stale: boolean;
}) {
    const id = randomUUID();
    createdAttemptIds.push(id);
    await prisma.paymentAttempt.create({
        data: {
            id,
            checkoutId: randomUUID(),
            requestFingerprint: 'b'.repeat(64),
            amountCents: 72_500,
            currency: 'USD',
            providerIntentId: input.providerIntentId,
            status: input.status ?? 'REQUIRES_ACTION',
        },
    });
    if (input.stale) {
        await prisma.$executeRaw`
            UPDATE "PaymentAttempt"
            SET "updatedAt" = statement_timestamp() - interval '11 minutes'
            WHERE "id" = ${id}
        `;
    }
    return id;
}

afterEach(async () => {
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: createdAttemptIds } } });
    createdAttemptIds.length = 0;
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('staff payment recovery queue', () => {
    it('shows only stale provider-backed attempts that have not reached a terminal state', async () => {
        const eligibleStatuses = [
            'CREATING',
            'REQUIRES_PAYMENT_METHOD',
            'REQUIRES_CONFIRMATION',
            'REQUIRES_ACTION',
            'PROCESSING',
            'AUTHORIZED',
        ] as const satisfies readonly PaymentAttemptStatus[];
        const staleActionable = await Promise.all(eligibleStatuses.map(status => createAttempt({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            status,
            stale: true,
        })));
        const fresh = await createAttempt({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            stale: false,
        });
        const missingProvider = await createAttempt({ providerIntentId: null, stale: true });
        const captured = await createAttempt({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            status: 'CAPTURED',
            stale: true,
        });
        const cancelled = await createAttempt({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            status: 'CANCELLED',
            stale: true,
        });

        const queuedIds = (await listStalePaymentAttempts()).map(attempt => attempt.id);

        expect(new Set(queuedIds)).toEqual(new Set(staleActionable));
        expect(queuedIds).not.toContain(fresh);
        expect(queuedIds).not.toContain(missingProvider);
        expect(queuedIds).not.toContain(captured);
        expect(queuedIds).not.toContain(cancelled);
    });

    it('returns the fifty oldest attempts in ascending update order', async () => {
        const attempts = Array.from({ length: 51 }, (_, index) => ({
            id: randomUUID(),
            updatedAt: new Date(Date.UTC(2020, 0, 1, 0, index)),
        }));
        const ids = attempts.map(attempt => attempt.id);
        createdAttemptIds.push(...ids);
        await prisma.paymentAttempt.createMany({
            data: attempts.map(attempt => ({
                id: attempt.id,
                checkoutId: randomUUID(),
                requestFingerprint: 'c'.repeat(64),
                amountCents: 12_500,
                currency: 'USD',
                providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
                status: 'PROCESSING' as const,
                updatedAt: attempt.updatedAt,
            })),
        });

        expect((await listStalePaymentAttempts()).map(attempt => attempt.id))
            .toEqual(ids.slice(0, 50));
    });

    it('starts at ten minutes, not one minute earlier', async () => {
        const atBoundary = await createAttempt({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            stale: false,
        });
        const oneMinuteEarly = await createAttempt({
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            stale: false,
        });
        await prisma.$executeRaw`
            UPDATE "PaymentAttempt"
            SET "updatedAt" = statement_timestamp() - interval '10 minutes 1 second'
            WHERE "id" = ${atBoundary}
        `;
        await prisma.$executeRaw`
            UPDATE "PaymentAttempt"
            SET "updatedAt" = statement_timestamp() - interval '9 minutes'
            WHERE "id" = ${oneMinuteEarly}
        `;

        const queuedIds = (await listStalePaymentAttempts()).map(attempt => attempt.id);

        expect(queuedIds).toContain(atBoundary);
        expect(queuedIds).not.toContain(oneMinuteEarly);
    });
});
