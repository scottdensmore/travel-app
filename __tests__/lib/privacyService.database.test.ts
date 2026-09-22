/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { exportUserData, deleteUserAccount, assertNoSensitiveExportData } from '@/lib/privacyService';
import { randomUUID } from 'node:crypto';

describe('privacyService database integration', () => {
    let testUserId: string;
    let notificationId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                name: 'GDPR Database Test User',
                email: `gdpr-test-${randomUUID()}@example.com`,
            },
        });
        testUserId = user.id;

        await prisma.notificationPreference.createMany({
            data: [
                {
                    userId: testUserId,
                    category: 'FLIGHT_STATUS',
                    channel: 'EMAIL',
                    enabled: true,
                },
                {
                    userId: testUserId,
                    category: 'ACCOUNT_ACTIVITY',
                    channel: 'IN_APP',
                    enabled: false,
                },
            ],
        });

        const notif = await prisma.notification.create({
            data: {
                userId: testUserId,
                title: 'Flight Gate Change',
                message: 'Your gate has changed to B4',
                type: 'FLIGHT_STATUS',
                category: 'FLIGHT_STATUS',
            },
        });
        notificationId = notif.id;

        await prisma.notificationDelivery.createMany({
            data: [
                {
                    notificationId: notif.id,
                    channel: 'EMAIL',
                    status: 'SENT',
                    recipient: user.email!,
                    attempts: 1,
                },
                {
                    notificationId: notif.id,
                    channel: 'IN_APP',
                    status: 'PENDING',
                    recipient: testUserId,
                    attempts: 0,
                },
            ],
        });
    });

    afterAll(async () => {
        if (notificationId) {
            await prisma.notificationDelivery.deleteMany({ where: { notificationId } }).catch(() => {});
            await prisma.notification.deleteMany({ where: { id: notificationId } }).catch(() => {});
        }
        if (testUserId) {
            await prisma.notificationPreference.deleteMany({ where: { userId: testUserId } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    it('exports notification preferences and notification deliveries in GDPR export', async () => {
        const exportData = await exportUserData(testUserId);

        expect(exportData.user.id).toBe(testUserId);
        expect(exportData.user.name).toBe('GDPR Database Test User');

        // Verify notification preferences are exported
        expect(exportData.notificationPreferences).toHaveLength(2);
        const flightStatusPref = exportData.notificationPreferences.find(p => p.category === 'FLIGHT_STATUS');
        expect(flightStatusPref).toMatchObject({
            category: 'FLIGHT_STATUS',
            channel: 'EMAIL',
            enabled: true,
        });
        const accountPref = exportData.notificationPreferences.find(p => p.category === 'ACCOUNT_ACTIVITY');
        expect(accountPref).toMatchObject({
            category: 'ACCOUNT_ACTIVITY',
            channel: 'IN_APP',
            enabled: false,
        });

        // Verify notifications include category and deliveries
        expect(exportData.notifications).toHaveLength(1);
        const exportedNotif = exportData.notifications[0];
        expect(exportedNotif.id).toBe(notificationId);
        expect(exportedNotif.category).toBe('FLIGHT_STATUS');
        expect(exportedNotif.deliveries).toBeDefined();
        expect(exportedNotif.deliveries).toHaveLength(2);

        const emailDelivery = exportedNotif.deliveries?.find(d => d.channel === 'EMAIL');
        expect(emailDelivery).toBeDefined();
        expect(emailDelivery).toMatchObject({
            channel: 'EMAIL',
            status: 'SENT',
            attempts: 1,
        });

        const inAppDelivery = exportedNotif.deliveries?.find(d => d.channel === 'IN_APP');
        expect(inAppDelivery).toBeDefined();
        expect(inAppDelivery).toMatchObject({
            channel: 'IN_APP',
            status: 'PENDING',
            recipient: testUserId,
            attempts: 0,
        });

        // Ensure security compliance
        expect(() => assertNoSensitiveExportData(exportData)).not.toThrow();
    });

    it('cleans up notification preferences, notifications, and deliveries during account deletion', async () => {
        const deleteResult = await deleteUserAccount(testUserId);
        expect(deleteResult.success).toBe(true);
        expect(deleteResult.anonymizedUserId).toBe(testUserId);

        // Verify preferences are deleted
        const remainingPreferences = await prisma.notificationPreference.findMany({
            where: { userId: testUserId },
        });
        expect(remainingPreferences).toHaveLength(0);

        // Verify notifications are deleted
        const remainingNotifications = await prisma.notification.findMany({
            where: { userId: testUserId },
        });
        expect(remainingNotifications).toHaveLength(0);

        // Verify deliveries cascaded and are deleted
        const remainingDeliveries = await prisma.notificationDelivery.findMany({
            where: { notificationId },
        });
        expect(remainingDeliveries).toHaveLength(0);

        // Verify user profile is anonymized
        const anonymizedUser = await prisma.user.findUnique({
            where: { id: testUserId },
        });
        expect(anonymizedUser).not.toBeNull();
        expect(anonymizedUser?.name).toBe('Deleted User');
        expect(anonymizedUser?.email).toBe(`deleted-${testUserId}@privacy.invalid`);
    });
});
