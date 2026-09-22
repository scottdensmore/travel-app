/** @jest-environment node */
import { NotificationService, DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/notificationService';
import { prisma } from '@/lib/prisma';
import * as notificationEmail from '@/lib/notificationEmail';
import { logger } from '@/lib/logger';

jest.mock('@/lib/notificationEmail');
jest.mock('@/lib/logger', () => ({
    logger: {
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

describe('NotificationService', () => {
    let service: NotificationService;

    beforeEach(() => {
        service = new NotificationService();
        jest.clearAllMocks();
    });

    describe('getEffectivePreferences', () => {
        it('returns default preferences when user has no stored rows', async () => {
            jest.spyOn(prisma.notificationPreference, 'findMany').mockResolvedValue([]);
            const result = await service.getEffectivePreferences('user-1');
            expect(result).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
        });

        it('merges stored user preferences over default preferences', async () => {
            jest.spyOn(prisma.notificationPreference, 'findMany').mockResolvedValue([
                {
                    id: 'pref-1',
                    userId: 'user-1',
                    category: 'TRAVEL_GUIDES',
                    channel: 'EMAIL',
                    enabled: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ] as any);

            const result = await service.getEffectivePreferences('user-1');
            expect(result.TRAVEL_GUIDES.EMAIL).toBe(true);
            expect(result.FLIGHT_STATUS.EMAIL).toBe(true);
            expect(result.ACCOUNT_ACTIVITY.EMAIL).toBe(true);
            expect(result.TRAVEL_GUIDES.IN_APP).toBe(true);
        });
    });

    describe('updatePreferences', () => {
        it('executes a transaction upserting each preference item', async () => {
            jest.spyOn(prisma, '$transaction').mockResolvedValue([] as any);
            jest.spyOn(prisma.notificationPreference, 'upsert').mockReturnValue({} as any);

            const updates = [
                { category: 'FLIGHT_STATUS' as const, channel: 'EMAIL' as const, enabled: false },
                { category: 'TRAVEL_GUIDES' as const, channel: 'IN_APP' as const, enabled: false },
            ];

            await service.updatePreferences('user-1', updates);

            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
                where: {
                    userId_category_channel: {
                        userId: 'user-1',
                        category: 'FLIGHT_STATUS',
                        channel: 'EMAIL',
                    },
                },
                create: {
                    userId: 'user-1',
                    category: 'FLIGHT_STATUS',
                    channel: 'EMAIL',
                    enabled: false,
                },
                update: {
                    enabled: false,
                },
            });
            expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
                where: {
                    userId_category_channel: {
                        userId: 'user-1',
                        category: 'TRAVEL_GUIDES',
                        channel: 'IN_APP',
                    },
                },
                create: {
                    userId: 'user-1',
                    category: 'TRAVEL_GUIDES',
                    channel: 'IN_APP',
                    enabled: false,
                },
                update: {
                    enabled: false,
                },
            });
        });

        it('throws ZodError when updates array is empty or contains invalid items', async () => {
            await expect(service.updatePreferences('user-1', [])).rejects.toThrow();

            await expect(
                service.updatePreferences('user-1', [
                    { category: 'INVALID' as any, channel: 'EMAIL', enabled: true },
                ])
            ).rejects.toThrow();
        });
    });

    describe('dispatchNotification', () => {
        it('returns early and logs warning if user is not found', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
            jest.spyOn(prisma.notification, 'create');

            await service.dispatchNotification({
                userId: 'user-unknown',
                title: 'Test',
                message: 'Hello',
                category: 'FLIGHT_STATUS',
            });

            expect(prisma.notification.create).not.toHaveBeenCalled();
            expect(notificationEmail.sendNotificationEmail).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('User not found when dispatching notification: user-unknown'),
                expect.objectContaining({ userId: 'user-unknown' })
            );
        });

        it('creates in-app notification and delivery when IN_APP is enabled', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: false },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-1', userId: 'user-1', title: 'Test', message: 'Hello' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create').mockResolvedValue({ id: 'del-1' } as any);

            await service.dispatchNotification({
                userId: 'user-1',
                title: 'Test',
                message: 'Hello',
                category: 'FLIGHT_STATUS',
            });

            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: {
                    userId: 'user-1',
                    title: 'Test',
                    message: 'Hello',
                    category: 'FLIGHT_STATUS',
                    type: 'FLIGHT_STATUS',
                },
            });
            expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    notificationId: 'notif-1',
                    channel: 'IN_APP',
                    status: 'SENT',
                    recipient: 'user-1',
                    attempts: 1,
                }),
            });
            expect(notificationEmail.sendNotificationEmail).not.toHaveBeenCalled();
        });

        it('uses custom type when provided', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: false },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-custom', userId: 'user-1', title: 'Custom', message: 'Hello' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create').mockResolvedValue({ id: 'del-custom' } as any);

            await service.dispatchNotification({
                userId: 'user-1',
                title: 'Custom',
                message: 'Hello',
                category: 'FLIGHT_STATUS',
                type: 'GATE_CHANGE',
            });

            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: 'GATE_CHANGE',
                }),
            });
        });

        it('dispatches email successfully and updates delivery status to SENT', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-1', userId: 'user-1', title: 'Flight Delayed', message: 'Delayed by 1h' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create')
                .mockResolvedValueOnce({ id: 'del-inapp' } as any)
                .mockResolvedValueOnce({ id: 'del-email' } as any);
            jest.spyOn(prisma.notificationDelivery, 'update').mockResolvedValue({} as any);

            (notificationEmail.sendNotificationEmail as jest.Mock).mockResolvedValue(undefined);

            await service.dispatchNotification({
                userId: 'user-1',
                title: 'Flight Delayed',
                message: 'Delayed by 1h',
                category: 'FLIGHT_STATUS',
            });

            expect(notificationEmail.sendNotificationEmail).toHaveBeenCalledWith({
                to: 'user@example.com',
                title: 'Flight Delayed',
                message: 'Delayed by 1h',
            });
            expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
                where: { id: 'del-email' },
                data: expect.objectContaining({
                    status: 'SENT',
                    attempts: 1,
                }),
            });
        });

        it('marks notification as read when only delivered by email', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: false, EMAIL: true },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-email-only', userId: 'user-1', title: 'Email Only', message: 'Check email' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create').mockResolvedValue({ id: 'del-email-only' } as any);
            jest.spyOn(prisma.notificationDelivery, 'update').mockResolvedValue({} as any);

            (notificationEmail.sendNotificationEmail as jest.Mock).mockResolvedValue(undefined);

            await service.dispatchNotification({
                userId: 'user-1',
                title: 'Email Only',
                message: 'Check email',
                category: 'FLIGHT_STATUS',
            });

            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    isRead: true,
                }),
            });
        });

        it('dispatches email and marks FAILED when provider throws without bubbling error', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-1',
                email: 'user@example.com',
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-1', userId: 'user-1', title: 'Flight Cancelled', message: 'Sorry' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create')
                .mockResolvedValueOnce({ id: 'del-inapp' } as any)
                .mockResolvedValueOnce({ id: 'del-email' } as any);
            jest.spyOn(prisma.notificationDelivery, 'update').mockResolvedValue({} as any);

            (notificationEmail.sendNotificationEmail as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

            // Must NOT throw
            await expect(
                service.dispatchNotification({
                    userId: 'user-1',
                    title: 'Flight Cancelled',
                    message: 'Sorry',
                    category: 'FLIGHT_STATUS',
                })
            ).resolves.not.toThrow();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to dispatch notification email to user@example.com: Connection timeout'),
                expect.objectContaining({
                    deliveryId: 'del-email',
                    error: 'Connection timeout',
                })
            );

            expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
                where: { id: 'del-email' },
                data: expect.objectContaining({
                    status: 'FAILED',
                    error: 'Connection timeout',
                    attempts: 1,
                }),
            });
        });

        it('does not send email if user has no email address', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
                id: 'user-no-email',
                email: null,
            } as any);

            jest.spyOn(service, 'getEffectivePreferences').mockResolvedValue({
                FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            });

            const mockNotif = { id: 'notif-no-email', userId: 'user-no-email', title: 'Test', message: 'Hello' };
            jest.spyOn(prisma.notification, 'create').mockResolvedValue(mockNotif as any);
            jest.spyOn(prisma.notificationDelivery, 'create').mockResolvedValue({ id: 'del-inapp' } as any);

            await service.dispatchNotification({
                userId: 'user-no-email',
                title: 'Test',
                message: 'Hello',
                category: 'FLIGHT_STATUS',
            });

            expect(notificationEmail.sendNotificationEmail).not.toHaveBeenCalled();
            expect(prisma.notificationDelivery.create).toHaveBeenCalledTimes(1);
            expect(prisma.notificationDelivery.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ channel: 'IN_APP' }),
                })
            );
        });
    });

    describe('retryDelivery', () => {
        it('throws error if delivery channel is not EMAIL', async () => {
            jest.spyOn(prisma.notificationDelivery, 'findUniqueOrThrow').mockResolvedValue({
                id: 'del-inapp',
                channel: 'IN_APP',
                status: 'FAILED',
                recipient: 'user-1',
                notification: { title: 'Test', message: 'Hello' },
            } as any);

            await expect(service.retryDelivery('del-inapp')).rejects.toThrow(
                'Only email deliveries can be retried.'
            );
            expect(notificationEmail.sendNotificationEmail).not.toHaveBeenCalled();
        });

        it('throws error if delivery has already been sent', async () => {
            jest.spyOn(prisma.notificationDelivery, 'findUniqueOrThrow').mockResolvedValue({
                id: 'del-already-sent',
                channel: 'EMAIL',
                status: 'SENT',
                recipient: 'user@example.com',
                notification: { title: 'Test', message: 'Hello' },
            } as any);

            await expect(service.retryDelivery('del-already-sent')).rejects.toThrow(
                'Cannot retry a delivery that has already been sent.'
            );
            expect(notificationEmail.sendNotificationEmail).not.toHaveBeenCalled();
        });

        it('re-sends email and updates delivery to SENT with incremented attempts', async () => {
            jest.spyOn(prisma.notificationDelivery, 'findUniqueOrThrow').mockResolvedValue({
                id: 'del-email-1',
                channel: 'EMAIL',
                status: 'FAILED',
                recipient: 'user@example.com',
                notification: { title: 'Flight Alert', message: 'Gate changed' },
            } as any);

            (notificationEmail.sendNotificationEmail as jest.Mock).mockResolvedValue(undefined);
            jest.spyOn(prisma.notificationDelivery, 'update').mockResolvedValue({} as any);

            await service.retryDelivery('del-email-1');

            expect(notificationEmail.sendNotificationEmail).toHaveBeenCalledWith({
                to: 'user@example.com',
                title: 'Flight Alert',
                message: 'Gate changed',
            });

            expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
                where: { id: 'del-email-1' },
                data: expect.objectContaining({
                    status: 'SENT',
                    attempts: { increment: 1 },
                    error: null,
                }),
            });
        });

        it('updates delivery to FAILED and re-throws error if retry fails', async () => {
            jest.spyOn(prisma.notificationDelivery, 'findUniqueOrThrow').mockResolvedValue({
                id: 'del-email-fail',
                channel: 'EMAIL',
                recipient: 'user@example.com',
                notification: { title: 'Flight Alert', message: 'Gate changed' },
            } as any);

            (notificationEmail.sendNotificationEmail as jest.Mock).mockRejectedValue(new Error('SMTP down'));
            jest.spyOn(prisma.notificationDelivery, 'update').mockResolvedValue({} as any);

            await expect(service.retryDelivery('del-email-fail')).rejects.toThrow('SMTP down');

            expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
                where: { id: 'del-email-fail' },
                data: expect.objectContaining({
                    status: 'FAILED',
                    error: 'SMTP down',
                    attempts: { increment: 1 },
                }),
            });
        });
    });
});
