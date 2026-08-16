/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { PaymentRefundService } from '@/lib/paymentRefundService';
import type { PaymentRefundState, RefundProvider } from '@/lib/stripePaymentProvider';

const created = { bookingIds: [] as number[], userIds: [] as string[] };

function provider(result: PaymentRefundState = {
    providerRefundId: 're_refund',
    paymentRefundId: null,
    refundAttemptId: null,
    status: 'SUCCEEDED',
}) {
    const createRefund = jest.fn().mockResolvedValue(result);
    const retrieveRefund = jest.fn().mockResolvedValue(result);
    const findRefund = jest.fn().mockResolvedValue(null);
    return {
        value: { createRefund, retrieveRefund, findRefund } satisfies RefundProvider,
        createRefund,
        retrieveRefund,
        findRefund,
    };
}

async function pendingRefund(amountCents = 24_000) {
    const user = await prisma.user.create({
        data: { email: `payment-refund-${randomUUID()}@example.com` },
    });
    created.userIds.push(user.id);
    const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            paymentIntentId: providerIntentId,
            totalPriceCents: 30_000,
            currency: 'USD',
        },
    });
    created.bookingIds.push(booking.id);
    const change = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.booking_refund_cents', ${String(amountCents)}, true)`;
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        return tx.bookingStatusChange.findFirstOrThrow({
            where: { bookingId: booking.id, to: 'CANCELLED' },
            orderBy: { sequence: 'desc' },
        });
    });
    const refund = await prisma.paymentRefund.create({
        data: {
            bookingStatusChangeId: change.id,
            providerIntentId,
            amountCents,
            currency: 'USD',
        },
    });
    return { refund, booking, change };
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('settling a cancellation refund', () => {
    async function expectRejectedMismatch(
        data: { amountCents?: number; providerIntentId?: string; currency?: string },
    ) {
        const { refund } = await pendingRefund();
        await prisma.paymentRefund.update({ where: { id: refund.id }, data });
        const fake = provider();

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .rejects.toThrow('Refund does not match the cancelled booking payment.');
        expect(fake.createRefund).not.toHaveBeenCalled();
        expect(fake.retrieveRefund).not.toHaveBeenCalled();
        expect(fake.findRefund).not.toHaveBeenCalled();
    }

    it('submits the immutable cancellation amount and records provider success', async () => {
        const { refund } = await pendingRefund();
        const fake = provider();
        fake.createRefund.mockImplementationOnce(async input => ({
            providerRefundId: 're_succeeded',
            paymentRefundId: refund.id,
            refundAttemptId: input.refundAttemptId,
            status: 'SUCCEEDED',
        }));

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: true });
        expect(fake.createRefund).toHaveBeenCalledWith({
            refundId: refund.id,
            refundAttemptId: expect.any(String),
            providerIntentId: refund.providerIntentId,
            amountCents: 24_000,
        });
        await expect(prisma.paymentRefund.findUniqueOrThrow({
            where: { id: refund.id },
            include: { attempts: true },
        })).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: [expect.objectContaining({
                providerRefundId: 're_succeeded',
                status: 'SUCCEEDED',
            })],
        });
    });

    it('recovers a refund whose provider response was lost without submitting another', async () => {
        const { refund } = await pendingRefund();
        let attemptId = '';
        const recovered = {
            providerRefundId: 're_recovered',
            paymentRefundId: refund.id,
            get refundAttemptId() { return attemptId; },
            status: 'SUCCEEDED' as const,
        };
        const fake = provider(recovered);
        fake.createRefund.mockImplementationOnce(async input => {
            attemptId = input.refundAttemptId;
            throw new Error('connection ended after refund');
        });
        fake.findRefund.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: true });
        expect(fake.createRefund).toHaveBeenCalledTimes(1);
        expect(fake.findRefund).toHaveBeenCalledTimes(2);
        await expect(prisma.paymentRefundAttempt.findUniqueOrThrow({ where: { id: attemptId } }))
            .resolves.toMatchObject({ providerRefundId: 're_recovered', status: 'SUCCEEDED' });
    });

    it('reconciles a known provider refund instead of creating another', async () => {
        const { refund } = await pendingRefund();
        const attempt = await prisma.paymentRefundAttempt.create({
            data: {
                id: randomUUID(),
                paymentRefundId: refund.id,
                providerRefundId: 're_pending',
            },
        });
        const fake = provider({
            providerRefundId: 're_pending',
            paymentRefundId: refund.id,
            refundAttemptId: attempt.id,
            status: 'SUCCEEDED',
        });

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: false });
        expect(fake.retrieveRefund).toHaveBeenCalledWith('re_pending');
        expect(fake.createRefund).not.toHaveBeenCalled();
    });

    it('does not contact Stripe again after success is durable', async () => {
        const { refund } = await pendingRefund();
        await prisma.paymentRefund.update({
            where: { id: refund.id },
            data: {
                status: 'SUCCEEDED',
                attempts: {
                    create: {
                        id: randomUUID(),
                        providerRefundId: 're_done',
                        status: 'SUCCEEDED',
                    },
                },
            },
        });
        const fake = provider();

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: false });
        expect(fake.createRefund).not.toHaveBeenCalled();
        expect(fake.retrieveRefund).not.toHaveBeenCalled();
        expect(fake.findRefund).not.toHaveBeenCalled();
    });

    it('starts a new durable attempt after a terminal provider failure', async () => {
        const { refund } = await pendingRefund();
        const fake = provider();
        fake.createRefund
            .mockImplementationOnce(async input => ({
                providerRefundId: 're_failed',
                paymentRefundId: refund.id,
                refundAttemptId: input.refundAttemptId,
                status: 'FAILED',
            }))
            .mockImplementationOnce(async input => ({
                providerRefundId: 're_retry',
                paymentRefundId: refund.id,
                refundAttemptId: input.refundAttemptId,
                status: 'SUCCEEDED',
            }));

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'FAILED', wasSubmitted: true });
        const failedAttemptId = fake.createRefund.mock.calls[0][0].refundAttemptId;
        await expect(prisma.paymentRefundAttempt.findUniqueOrThrow({
            where: { id: failedAttemptId },
        })).resolves.toMatchObject({ providerRefundId: 're_failed', status: 'FAILED' });

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: true });
        const retryAttemptId = fake.createRefund.mock.calls[1][0].refundAttemptId;
        expect(retryAttemptId).not.toBe(failedAttemptId);
        expect(await prisma.paymentRefundAttempt.count({
            where: { paymentRefundId: refund.id },
        })).toBe(2);
        const attempts = await prisma.paymentRefundAttempt.findMany({
            where: { paymentRefundId: refund.id },
            orderBy: { sequence: 'asc' },
        });
        expect(attempts.map(attempt => attempt.id)).toEqual([failedAttemptId, retryAttemptId]);
        expect(attempts[1].sequence).toBeGreaterThan(attempts[0].sequence);
    });

    it('waits for the refund lock before preparing a concurrent terminal retry', async () => {
        const { refund } = await pendingRefund();
        await prisma.paymentRefund.update({
            where: { id: refund.id },
            data: {
                status: 'FAILED',
                attempts: {
                    create: {
                        id: randomUUID(),
                        providerRefundId: 're_concurrent_failed',
                        status: 'FAILED',
                    },
                },
            },
        });
        const fake = provider();
        fake.createRefund.mockImplementation(async input => ({
            providerRefundId: `re_concurrent_${input.refundAttemptId}`,
            paymentRefundId: refund.id,
            refundAttemptId: input.refundAttemptId,
            status: 'SUCCEEDED',
        }));

        let announceLock!: () => void;
        let releaseLock!: () => void;
        const lockHeld = new Promise<void>(resolve => { announceLock = resolve; });
        const release = new Promise<void>(resolve => { releaseLock = resolve; });
        const blocker = prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${refund.id}))`;
            announceLock();
            await release;
        });
        await lockHeld;

        const settlement = new PaymentRefundService(fake.value).settleRefund(refund.id);
        try {
            let waiting = false;
            for (let attempt = 0; attempt < 50 && !waiting; attempt += 1) {
                const [locks] = await prisma.$queryRaw<Array<{ count: bigint }>>`
                    SELECT count(*)::bigint AS count
                    FROM pg_locks
                    WHERE locktype = 'advisory' AND NOT granted
                `;
                waiting = locks.count > BigInt(0);
                if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
            expect(fake.createRefund).not.toHaveBeenCalled();
        } finally {
            releaseLock();
            await blocker;
        }

        await expect(settlement).resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: true });
        expect(await prisma.paymentRefundAttempt.count({
            where: { paymentRefundId: refund.id },
        })).toBe(2);
    });

    it('does not let a delayed pending response overwrite concurrent success', async () => {
        const { refund } = await pendingRefund();
        let announceFirstSubmission!: () => void;
        let releasePending!: () => void;
        const firstSubmitted = new Promise<void>(resolve => { announceFirstSubmission = resolve; });
        const pendingMayReturn = new Promise<void>(resolve => { releasePending = resolve; });
        const fake = provider();
        fake.createRefund
            .mockImplementationOnce(async input => {
                announceFirstSubmission();
                await pendingMayReturn;
                return {
                    providerRefundId: 're_concurrent_state',
                    paymentRefundId: refund.id,
                    refundAttemptId: input.refundAttemptId,
                    status: 'PENDING',
                };
            })
            .mockImplementationOnce(async input => ({
                providerRefundId: 're_concurrent_state',
                paymentRefundId: refund.id,
                refundAttemptId: input.refundAttemptId,
                status: 'SUCCEEDED',
            }));

        const delayed = new PaymentRefundService(fake.value).settleRefund(refund.id);
        await firstSubmitted;
        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: true });
        releasePending();

        await expect(delayed).resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: true });
        expect(new Set(fake.createRefund.mock.calls.map(call => call[0].refundAttemptId)).size)
            .toBe(1);
        await expect(prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } }))
            .resolves.toMatchObject({ status: 'SUCCEEDED' });
        await expect(prisma.paymentRefundAttempt.findFirstOrThrow({
            where: { paymentRefundId: refund.id },
        })).resolves.toMatchObject({ status: 'SUCCEEDED' });
    });

    it('does not let a delayed response replace a concurrent provider refund ID', async () => {
        const { refund } = await pendingRefund();
        let announceFirstSubmission!: () => void;
        let releaseDelayed!: () => void;
        const firstSubmitted = new Promise<void>(resolve => { announceFirstSubmission = resolve; });
        const delayedMayReturn = new Promise<void>(resolve => { releaseDelayed = resolve; });
        const fake = provider();
        fake.createRefund
            .mockImplementationOnce(async input => {
                announceFirstSubmission();
                await delayedMayReturn;
                return {
                    providerRefundId: 're_late_conflict',
                    paymentRefundId: refund.id,
                    refundAttemptId: input.refundAttemptId,
                    status: 'PENDING',
                };
            })
            .mockImplementationOnce(async input => ({
                providerRefundId: 're_current_provider',
                paymentRefundId: refund.id,
                refundAttemptId: input.refundAttemptId,
                status: 'PENDING',
            }));

        const delayed = new PaymentRefundService(fake.value).settleRefund(refund.id);
        await firstSubmitted;
        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'PENDING', wasSubmitted: true });
        releaseDelayed();

        await expect(delayed)
            .rejects.toThrow('Stripe refund metadata does not match the durable refund attempt.');
        await expect(prisma.paymentRefundAttempt.findFirstOrThrow({
            where: { paymentRefundId: refund.id },
        })).resolves.toMatchObject({ providerRefundId: 're_current_provider', status: 'PENDING' });
    });

    it('rejects a refund linked to a non-cancellation history row', async () => {
        const { booking } = await pendingRefund();
        const creation = await prisma.bookingStatusChange.findFirstOrThrow({
            where: { bookingId: booking.id, from: null, to: 'CONFIRMED' },
        });
        const refund = await prisma.paymentRefund.create({
            data: {
                bookingStatusChangeId: creation.id,
                providerIntentId: booking.paymentIntentId!,
                amountCents: 1,
            },
        });
        const fake = provider();

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .rejects.toThrow('Refund does not match the cancelled booking payment.');
        expect(fake.createRefund).not.toHaveBeenCalled();
    });

    it('rejects a refund amount that differs from immutable cancellation history', async () => {
        await expectRejectedMismatch({ amountCents: 7_999 });
    });

    it('rejects a refund for a different PaymentIntent', async () => {
        await expectRejectedMismatch({ providerIntentId: 'pi_different' });
    });

    it('rejects a refund in a different currency from its booking', async () => {
        await expectRejectedMismatch({ currency: 'CAD' });
    });

    it('refuses a retrieved provider refund with a different provider ID', async () => {
        const { refund } = await pendingRefund();
        const attempt = await prisma.paymentRefundAttempt.create({
            data: {
                id: randomUUID(),
                paymentRefundId: refund.id,
                providerRefundId: 're_expected',
            },
        });
        const fake = provider({
            providerRefundId: 're_different',
            paymentRefundId: refund.id,
            refundAttemptId: attempt.id,
            status: 'SUCCEEDED',
        });

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .rejects.toThrow('Stripe refund metadata does not match the durable refund attempt.');
        await expect(prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } }))
            .resolves.toMatchObject({ status: 'PENDING' });
    });

    it('reconciles the latest sequenced attempt when timestamps cannot order retries', async () => {
        const { refund } = await pendingRefund();
        await prisma.$transaction(async tx => {
            await tx.paymentRefundAttempt.create({
                data: {
                    id: randomUUID(), paymentRefundId: refund.id,
                    providerRefundId: 're_old_failed', status: 'FAILED',
                },
            });
            await tx.paymentRefundAttempt.create({
                data: {
                    id: randomUUID(), paymentRefundId: refund.id,
                    providerRefundId: 're_current', status: 'PENDING',
                },
            });
        });
        const current = await prisma.paymentRefundAttempt.findFirstOrThrow({
            where: { paymentRefundId: refund.id },
            orderBy: { sequence: 'desc' },
        });
        const fake = provider({
            providerRefundId: 're_current',
            paymentRefundId: refund.id,
            refundAttemptId: current.id,
            status: 'SUCCEEDED',
        });

        await expect(new PaymentRefundService(fake.value).settleRefund(refund.id))
            .resolves.toEqual({ status: 'SUCCEEDED', wasSubmitted: false });
        expect(fake.retrieveRefund).toHaveBeenCalledWith('re_current');
        expect(fake.createRefund).not.toHaveBeenCalled();
    });
});
