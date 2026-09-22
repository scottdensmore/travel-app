import {
    getNotificationPreferencesAction,
    updateNotificationPreferencesAction,
    getAdminNotificationDeliveriesAction,
    retryNotificationDeliveryAction,
} from '@/app/actions/notificationActions';
import { getServerSession } from 'next-auth';
import { hasVerifiedStaffAccess } from '@/lib/staffMfa';
import { prisma } from '@/lib/prisma';
import { NotificationService } from '@/lib/notificationService';
import { revalidatePath } from 'next/cache';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));
jest.mock('@/lib/staffMfa');
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({
    prisma: {
        notificationDelivery: {
            findMany: jest.fn(),
            count: jest.fn(),
            findUnique: jest.fn(),
        },
    },
}));
jest.mock('@/lib/notificationService');

describe('Notification Server Actions', () => {
    let mockNotificationService: jest.Mocked<NotificationService>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockNotificationService = {
            getEffectivePreferences: jest.fn(),
            updatePreferences: jest.fn(),
            dispatchNotification: jest.fn(),
            retryDelivery: jest.fn(),
        } as unknown as jest.Mocked<NotificationService>;
        (NotificationService as unknown as jest.Mock).mockImplementation(() => mockNotificationService);
    });

    describe('getNotificationPreferencesAction', () => {
        it('rejects unauthenticated traveler from getting preferences', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            const result = await getNotificationPreferencesAction();
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('returns effective preferences for authenticated traveler', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            const mockPreferences = {
                FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
                ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
                TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
            };
            mockNotificationService.getEffectivePreferences.mockResolvedValue(mockPreferences);

            const result = await getNotificationPreferencesAction();
            expect(result).toEqual({ ok: true, data: mockPreferences });
            expect(mockNotificationService.getEffectivePreferences).toHaveBeenCalledWith('user-1');
        });

        it('handles service errors gracefully', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            mockNotificationService.getEffectivePreferences.mockRejectedValue(new Error('DB failure'));

            const result = await getNotificationPreferencesAction();
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });
    });

    describe('updateNotificationPreferencesAction', () => {
        it('rejects unauthenticated traveler', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            const result = await updateNotificationPreferencesAction([
                { category: 'FLIGHT_STATUS', channel: 'EMAIL', enabled: false },
            ]);
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('rejects invalid payload', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            const result = await updateNotificationPreferencesAction([]);
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('updates preferences and revalidates path on valid input', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            mockNotificationService.updatePreferences.mockResolvedValue();

            const updates = [
                { category: 'FLIGHT_STATUS', channel: 'EMAIL', enabled: false },
            ];
            const result = await updateNotificationPreferencesAction(updates);

            expect(result).toEqual({ ok: true, data: { success: true } });
            expect(mockNotificationService.updatePreferences).toHaveBeenCalledWith('user-1', updates);
            expect(revalidatePath).toHaveBeenCalledWith('/profile/notifications');
        });

        it('handles service error gracefully', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            mockNotificationService.updatePreferences.mockRejectedValue(new Error('Update failed'));

            const updates = [
                { category: 'FLIGHT_STATUS', channel: 'EMAIL', enabled: false },
            ];
            const result = await updateNotificationPreferencesAction(updates);

            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });
    });

    describe('getAdminNotificationDeliveriesAction', () => {
        it('rejects non-staff user from accessing admin delivery logs', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(false);

            const result = await getAdminNotificationDeliveriesAction({});
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('rejects invalid query filters', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(true);

            const result = await getAdminNotificationDeliveriesAction({ page: -1 });
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('returns deliveries and total count for verified staff', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(true);

            const mockDeliveries = [
                {
                    id: 'del-1',
                    channel: 'EMAIL',
                    status: 'SENT',
                    recipient: 'user@example.com',
                    notification: { title: 'Test', message: 'Msg', category: 'FLIGHT_STATUS' },
                },
            ];
            (prisma.notificationDelivery.findMany as jest.Mock).mockResolvedValue(mockDeliveries);
            (prisma.notificationDelivery.count as jest.Mock).mockResolvedValue(1);

            const result = await getAdminNotificationDeliveriesAction({
                status: 'SENT',
                channel: 'EMAIL',
                page: 1,
                pageSize: 25,
            });

            expect(result).toEqual({
                ok: true,
                data: {
                    deliveries: mockDeliveries,
                    totalCount: 1,
                },
            });
            expect(prisma.notificationDelivery.findMany).toHaveBeenCalled();
            expect(prisma.notificationDelivery.count).toHaveBeenCalled();
        });
    });

    describe('retryNotificationDeliveryAction', () => {
        it('rejects non-staff user', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(false);

            const result = await retryNotificationDeliveryAction('del-1');
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('rejects empty delivery ID', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(true);

            const result = await retryNotificationDeliveryAction('');
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });

        it('retries delivery, revalidates admin path, and returns updated delivery', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(true);

            mockNotificationService.retryDelivery.mockResolvedValue();
            const mockDelivery = {
                id: 'del-1',
                channel: 'EMAIL',
                status: 'SENT',
                recipient: 'user@example.com',
            };
            (prisma.notificationDelivery.findUnique as jest.Mock).mockResolvedValue(mockDelivery);

            const result = await retryNotificationDeliveryAction('del-1');

            expect(result).toEqual({
                ok: true,
                data: {
                    success: true,
                    delivery: mockDelivery,
                },
            });
            expect(mockNotificationService.retryDelivery).toHaveBeenCalledWith('del-1');
            expect(revalidatePath).toHaveBeenCalledWith('/admin/notifications');
        });

        it('handles retry error gracefully', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
            (hasVerifiedStaffAccess as jest.Mock).mockResolvedValue(true);

            mockNotificationService.retryDelivery.mockRejectedValue(new Error('Retry failed'));

            const result = await retryNotificationDeliveryAction('del-1');
            expect(result).toEqual(expect.objectContaining({ ok: false }));
        });
    });
});
