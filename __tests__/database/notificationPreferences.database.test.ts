/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'node:crypto';

describe('Notification Preferences & Deliveries Database Constraints', () => {
    let testUserId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                name: 'Test Preference User',
                email: `test-pref-${randomUUID()}@example.com`,
            },
        });
        testUserId = user.id;
    });

    afterAll(async () => {
        await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    });

    it('enforces unique constraint on (userId, category, channel)', async () => {
        await (prisma as any).notificationPreference.create({
            data: {
                userId: testUserId,
                category: 'FLIGHT_STATUS',
                channel: 'EMAIL',
                enabled: true,
            },
        });

        await expect(
            (prisma as any).notificationPreference.create({
                data: {
                    userId: testUserId,
                    category: 'FLIGHT_STATUS',
                    channel: 'EMAIL',
                    enabled: false,
                },
            })
        ).rejects.toThrow();
    });

    it('cascades deletion of preferences and deliveries when user is deleted', async () => {
        const tempUser = await prisma.user.create({
            data: {
                name: 'Temp Cascade User',
                email: `temp-${randomUUID()}@example.com`,
            },
        });

        const pref = await (prisma as any).notificationPreference.create({
            data: {
                userId: tempUser.id,
                category: 'ACCOUNT_ACTIVITY',
                channel: 'IN_APP',
                enabled: true,
            },
        });

        const notif = await prisma.notification.create({
            data: {
                userId: tempUser.id,
                title: 'Cascade Test',
                message: 'Will be deleted',
                type: 'SYSTEM',
                category: 'ACCOUNT_ACTIVITY',
            } as any,
        });

        const delivery = await (prisma as any).notificationDelivery.create({
            data: {
                notificationId: notif.id,
                channel: 'IN_APP',
                status: 'SENT',
                recipient: tempUser.id,
            },
        });

        await prisma.user.delete({ where: { id: tempUser.id } });

        const prefAfter = await (prisma as any).notificationPreference.findUnique({ where: { id: pref.id } });
        const notifAfter = await prisma.notification.findUnique({ where: { id: notif.id } });
        const deliveryAfter = await (prisma as any).notificationDelivery.findUnique({ where: { id: delivery.id } });

        expect(prefAfter).toBeNull();
        expect(notifAfter).toBeNull();
        expect(deliveryAfter).toBeNull();
    });
});
