/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
            capturedAt: null,
        });
    });

    it('stamps capture once and does not let later writes move the receipt date', async () => {
        const user = await createUser();
        const attempt = await prisma.paymentAttempt.create({ data: attemptData(user.id) });
        created.attemptIds.push(attempt.id);

        const captured = await prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { status: 'CAPTURED' },
        });
        expect(captured.capturedAt).toBeInstanceOf(Date);

        const rewritten = await prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { capturedAt: new Date('2000-01-01T00:00:00Z') },
        });
        expect(rewritten.capturedAt).toEqual(captured.capturedAt);
    });

    it('stamps an attempt that is first persisted as captured', async () => {
        const user = await createUser();
        const forgedCaptureTime = new Date('2000-01-01T00:00:00Z');
        const attempt = await prisma.paymentAttempt.create({
            data: attemptData(user.id, {
                status: 'CAPTURED',
                capturedAt: forgedCaptureTime,
            }),
        });
        created.attemptIds.push(attempt.id);

        expect(attempt.capturedAt).toBeInstanceOf(Date);
        expect(attempt.capturedAt).not.toEqual(forgedCaptureTime);
    });

    it('does not let a captured attempt be downgraded', async () => {
        const user = await createUser();
        const attempt = await prisma.paymentAttempt.create({
            data: attemptData(user.id, { status: 'CAPTURED' }),
        });
        created.attemptIds.push(attempt.id);

        await expect(prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { status: 'AUTHORIZED' },
        })).rejects.toThrow('PaymentAttempt_captured_has_time');
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
            .resolves.toMatchObject({ status: 'CAPTURED', capturedAt: attempt.capturedAt });
    });

    it('does not let a caller pre-seed the capture time before capture', async () => {
        const user = await createUser();
        const attempt = await prisma.paymentAttempt.create({
            data: attemptData(user.id, { capturedAt: new Date('2000-01-01T00:00:00Z') }),
        });
        created.attemptIds.push(attempt.id);

        expect(attempt.capturedAt).toBeNull();
        const captured = await prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { status: 'CAPTURED' },
        });
        expect(captured.capturedAt).toBeInstanceOf(Date);
        expect(captured.capturedAt).not.toEqual(new Date('2000-01-01T00:00:00Z'));
    });

    it('backfills historical captured attempts from their last durable update', async () => {
        const migration = fs.readFileSync(path.join(
            process.cwd(),
            'prisma/migrations/20260816030000_add_payment_capture_time/migration.sql',
        ), 'utf8');
        const backfill = migration.match(
            /UPDATE "PaymentAttempt"\s+SET "capturedAt" = "updatedAt"\s+WHERE "status" = 'CAPTURED';/,
        )?.[0];

        expect(backfill).toBeDefined();

        await prisma.$transaction(async tx => {
            await tx.$executeRawUnsafe(
                'CREATE TEMP TABLE "PaymentAttemptCaptureMigrationProbe" '
                + '("status" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, '
                + '"capturedAt" TIMESTAMP(3)) ON COMMIT DROP',
            );
            await tx.$executeRawUnsafe(
                `INSERT INTO "PaymentAttemptCaptureMigrationProbe" ("status", "updatedAt") VALUES
                ('CAPTURED', '2026-06-03T12:34:56.789Z'),
                ('AUTHORIZED', '2026-06-04T12:34:56.789Z')`,
            );
            await tx.$executeRawUnsafe(
                backfill!.replaceAll('"PaymentAttempt"', '"PaymentAttemptCaptureMigrationProbe"'),
            );

            const rows = await tx.$queryRawUnsafe<Array<{
                status: string;
                capturedAt: Date | null;
            }>>(
                'SELECT "status", "capturedAt" FROM "PaymentAttemptCaptureMigrationProbe" '
                + 'ORDER BY "status"',
            );

            expect(rows).toEqual([
                { status: 'AUTHORIZED', capturedAt: null },
                { status: 'CAPTURED', capturedAt: new Date('2026-06-03T12:34:56.789Z') },
            ]);
        });
    });

    it('rejects a captured row without a capture time even if trigger execution is bypassed', async () => {
        const user = await createUser();

        await expect(prisma.$transaction(async tx => {
            // Exercise the constraint itself rather than letting the trigger
            // repair this intentionally invalid row first.
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.paymentAttempt.create({
                data: attemptData(user.id, { status: 'CAPTURED', capturedAt: null }),
            });
        })).rejects.toThrow('PaymentAttempt_captured_has_time');
    });

    it('rejects a capture time before capture even if trigger execution is bypassed', async () => {
        const user = await createUser();

        await expect(prisma.$transaction(async tx => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.paymentAttempt.create({
                data: attemptData(user.id, {
                    status: 'AUTHORIZED',
                    capturedAt: new Date('2000-01-01T00:00:00Z'),
                }),
            });
        })).rejects.toThrow('PaymentAttempt_captured_has_time');
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
