/** @jest-environment node */

import { prisma } from '@/lib/prisma';

const createdBookingIds: number[] = [];

async function booking(paymentIntentId?: string) {
    const saved = await prisma.booking.create({
        data: paymentIntentId === undefined ? {} : { paymentIntentId },
    });
    createdBookingIds.push(saved.id);
    return saved;
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.$disconnect();
});

describe('booking payment integrity', () => {
    it('rejects an empty non-null provider payment identifier', async () => {
        const saved = await booking();

        await expect(prisma.booking.update({
            where: { id: saved.id },
            data: { paymentIntentId: '   ' },
        })).rejects.toThrow('Booking_nonempty_payment_intent');
    });

    it('does not let one provider payment fund two bookings', async () => {
        const paymentIntentId = 'pi_one_booking_only';
        await booking(paymentIntentId);

        await expect(booking(paymentIntentId)).rejects.toMatchObject({ code: 'P2002' });
    });
});
