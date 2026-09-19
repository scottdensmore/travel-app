/**
 * @jest-environment node
 */
import { prisma } from '@/lib/prisma';
import * as customerSupportService from '@/lib/customerSupportService';
import { BookingStatus } from '@prisma/client';

describe('Customer Support Service', () => {
    let testUserId: string;
    let adminUserId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: { email: 'test.user@example.com', name: 'Test User' },
        });
        testUserId = user.id;

        const admin = await prisma.user.create({
            data: { email: 'admin.user@example.com', name: 'Admin User', role: 'ADMIN' },
        });
        adminUserId = admin.id;
    });

    afterAll(async () => {
        await prisma.user.deleteMany({
            where: { id: { in: [testUserId, adminUserId] } },
        });
    });

    afterEach(async () => {
        await prisma.booking.deleteMany();
    });

    describe('searchBookings', () => {
        it('can search bookings by reference', async () => {
            const booking = await prisma.booking.create({
                data: {
                    reference: 'MA-00000000000000ABCDEF',
                    userId: testUserId,
                },
            });

            const results = await customerSupportService.searchBookings({ reference: 'MA-00000000000000ABCDEF' });
            expect(results.length).toBe(1);
            expect(results[0].id).toBe(booking.id);
        });
    });

    describe('addInternalNote', () => {
        it('can add a note to a booking', async () => {
            const booking = await prisma.booking.create({
                data: {
                    reference: 'MA-00000000000000BEEF01',
                    userId: testUserId,
                },
            });

            const note = await customerSupportService.addInternalNote(booking.id, adminUserId, 'Test note');
            expect(note.text).toBe('Test note');
            expect(note.actorUserId).toBe(adminUserId);

            const fetchedBooking = await prisma.booking.findUniqueOrThrow({
                where: { id: booking.id },
                include: { notes: true },
            });
            expect(fetchedBooking.notes.length).toBe(1);
        });
    });

    describe('cancelAndRefundBooking', () => {
        it('cancels a booking and creates a status change', async () => {
            const booking = await prisma.booking.create({
                data: {
                    reference: 'MA-00000000000000DEAD01',
                    userId: testUserId,
                    status: BookingStatus.CONFIRMED,
                },
            });

            await customerSupportService.cancelAndRefundBooking(booking.id, adminUserId, 'Customer requested cancellation via phone');

            const updatedBooking = await prisma.booking.findUniqueOrThrow({
                where: { id: booking.id },
                include: { statusChanges: true },
            });

            expect(updatedBooking.status).toBe(BookingStatus.CANCELLED);
            expect(updatedBooking.statusChanges.length).toBeGreaterThan(0);
            const change = updatedBooking.statusChanges.find(c => c.to === BookingStatus.CANCELLED);
            expect(change).toBeDefined();
            expect(change?.actorUserId).toBe(adminUserId);
            expect(change?.reason).toBe('Customer requested cancellation via phone');
        });
    });
});
