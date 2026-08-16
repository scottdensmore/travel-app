/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const created = { bookingIds: [] as number[], userIds: [] as string[] };

async function cancellation() {
    const user = await prisma.user.create({
        data: { email: `refund-integrity-${randomUUID()}@example.com` },
    });
    created.userIds.push(user.id);
    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            paymentIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            totalPriceCents: 10_000,
        },
    });
    created.bookingIds.push(booking.id);
    const change = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.booking_refund_cents', '8000', true)`;
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        return tx.bookingStatusChange.findFirstOrThrow({
            where: { bookingId: booking.id, to: 'CANCELLED' },
        });
    });
    return { booking, change };
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('durable refund integrity', () => {
    it.each([
        [{ amountCents: 0 }, 'PaymentRefund_positive_amount'],
        [{ providerIntentId: '   ' }, 'PaymentRefund_nonempty_provider_intent'],
        [{ currency: 'usd' }, 'PaymentRefund_currency_format'],
    ])('rejects unsafe refund metadata %j', async (override, constraint) => {
        const { booking, change } = await cancellation();

        await expect(prisma.paymentRefund.create({
            data: {
                bookingStatusChangeId: change.id,
                providerIntentId: booking.paymentIntentId!,
                amountCents: 8_000,
                currency: 'USD',
                ...override,
            },
        })).rejects.toThrow(constraint);
    });

    it('allows only one refund request for one immutable cancellation', async () => {
        const { booking, change } = await cancellation();
        const data = {
            bookingStatusChangeId: change.id,
            providerIntentId: booking.paymentIntentId!,
            amountCents: 8_000,
        };
        await prisma.paymentRefund.create({ data });

        await expect(prisma.paymentRefund.create({ data }))
            .rejects.toMatchObject({ code: 'P2002' });
    });

    it('retains failed provider attempts and rejects empty provider IDs', async () => {
        const { booking, change } = await cancellation();
        const refund = await prisma.paymentRefund.create({
            data: {
                bookingStatusChangeId: change.id,
                providerIntentId: booking.paymentIntentId!,
                amountCents: 8_000,
            },
        });

        await expect(prisma.paymentRefundAttempt.create({
            data: {
                id: randomUUID(),
                paymentRefundId: refund.id,
                providerRefundId: '   ',
            },
        })).rejects.toThrow('PaymentRefundAttempt_nonempty_provider_refund');

        await expect(prisma.paymentRefundAttempt.create({
            data: { id: '   ', paymentRefundId: refund.id },
        })).rejects.toThrow('PaymentRefundAttempt_nonempty_id');
    });

    it('rejects duplicate provider refund IDs across durable attempts', async () => {
        const first = await cancellation();
        const second = await cancellation();
        const firstRefund = await prisma.paymentRefund.create({
            data: {
                bookingStatusChangeId: first.change.id,
                providerIntentId: first.booking.paymentIntentId!,
                amountCents: 8_000,
            },
        });
        const secondRefund = await prisma.paymentRefund.create({
            data: {
                bookingStatusChangeId: second.change.id,
                providerIntentId: second.booking.paymentIntentId!,
                amountCents: 8_000,
            },
        });
        await prisma.paymentRefundAttempt.create({
            data: {
                id: randomUUID(),
                paymentRefundId: firstRefund.id,
                providerRefundId: 're_unique_provider_result',
            },
        });

        await expect(prisma.paymentRefundAttempt.create({
            data: {
                id: randomUUID(),
                paymentRefundId: secondRefund.id,
                providerRefundId: 're_unique_provider_result',
            },
        })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('requires every refund to reference real cancellation history', async () => {
        await expect(prisma.paymentRefund.create({
            data: {
                bookingStatusChangeId: randomUUID(),
                providerIntentId: 'pi_missing_history',
                amountCents: 8_000,
            },
        })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('requires every attempt to reference a real durable refund', async () => {
        await expect(prisma.paymentRefundAttempt.create({
            data: { id: randomUUID(), paymentRefundId: randomUUID() },
        })).rejects.toMatchObject({ code: 'P2003' });
    });
});
