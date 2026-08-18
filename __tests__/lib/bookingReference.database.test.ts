/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const createdBookingIds: number[] = [];

async function createBooking() {
    const booking = await prisma.booking.create({ data: {} });
    createdBookingIds.push(booking.id);
    return booking;
}

async function referenceFor(bookingId: number) {
    const [booking] = await prisma.$queryRaw<Array<{ reference: string }>>`
        SELECT "reference" FROM "Booking" WHERE "id" = ${bookingId}
    `;
    return booking.reference;
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.$disconnect();
});

describe('booking confirmation references', () => {
    it('gives every booking a unique, customer-usable reference by default', async () => {
        const first = await createBooking();
        const second = await createBooking();
        const references = await Promise.all([referenceFor(first.id), referenceFor(second.id)]);

        expect(references[0]).toMatch(/^MA-[0-9A-F]{20}$/);
        expect(references[1]).toMatch(/^MA-[0-9A-F]{20}$/);
        expect(new Set(references).size).toBe(2);
    });

    it('refuses a duplicate even when a caller bypasses the product service', async () => {
        const booking = await createBooking();
        const reference = await referenceFor(booking.id);

        await expect(prisma.$executeRaw(
            Prisma.sql`INSERT INTO "Booking" ("reference") VALUES (${reference})`,
        )).rejects.toThrow(/23505|unique constraint|duplicate key|already exists/i);
    });

    it('refuses a reference outside the customer-visible format', async () => {
        await expect(prisma.$executeRaw`
            INSERT INTO "Booking" ("reference") VALUES ('guessable-123')
        `).rejects.toThrow(/Booking_reference_format|check constraint/i);
    });

    it('keeps the reference immutable for the lifetime of the booking', async () => {
        const booking = await createBooking();
        const original = await referenceFor(booking.id);

        await expect(prisma.$executeRaw`
            UPDATE "Booking"
            SET "reference" = 'MA-AAAAAAAAAAAAAAAAAAAA'
            WHERE "id" = ${booking.id}
        `).rejects.toThrow(/reference.*immutable/i);

        await expect(referenceFor(booking.id)).resolves.toBe(original);
    });
});
