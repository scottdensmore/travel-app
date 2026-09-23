/** @jest-environment node */

import React from 'react';
import AdminNotificationsPage from '@/app/admin/notifications/page';
import AdminNotificationDeliveriesClient from '@/components/admin/AdminNotificationDeliveriesClient';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    redirect: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/staffAuthorization', () => ({
    hasStaffPermission: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
    prisma: {
        notificationDelivery: {
            count: jest.fn(),
            findMany: jest.fn(),
        },
    },
}));

jest.mock('@/components/admin/AdminNotificationDeliveriesClient', () => ({
    __esModule: true,
    default: function AdminNotificationDeliveriesClientMock() {
        return null;
    },
}));

function findElement(node: unknown, type: React.ElementType): React.ReactElement | null {
    if (!React.isValidElement(node)) return null;
    if (node.type === type) return node;
    const children = React.Children.toArray(
        (node.props as { children?: React.ReactNode }).children
    );
    for (const child of children) {
        const found = findElement(child, type);
        if (found) return found;
    }
    return null;
}

describe('/admin/notifications page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('redirects to /login if user is not authenticated', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await AdminNotificationsPage();

        expect(hasStaffPermission).toHaveBeenCalledWith(null, StaffPermission.NOTIFICATIONS_READ);
        expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('redirects to /admin if authenticated staff lacks NOTIFICATIONS_READ permission', async () => {
        const session = { user: { role: 'MODERATOR', staffMfaVerified: true } };
        (getServerSession as jest.Mock).mockResolvedValue(session);
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await AdminNotificationsPage();

        expect(hasStaffPermission).toHaveBeenCalledWith(session, StaffPermission.NOTIFICATIONS_READ);
        expect(redirect).toHaveBeenCalledWith('/admin');
    });

    it('loads initial deliveries and counts, then renders AdminNotificationDeliveriesClient when user has NOTIFICATIONS_READ', async () => {
        const session = { user: { role: 'ADMIN', staffMfaVerified: true } };
        (getServerSession as jest.Mock).mockResolvedValue(session);
        (hasStaffPermission as jest.Mock).mockReturnValue(true);

        const mockDeliveries = [
            {
                id: 'del-1',
                channel: 'EMAIL',
                status: 'SENT',
                recipient: 'test@example.com',
                attempts: 1,
                createdAt: new Date(),
                notification: {
                    id: 'notif-1',
                    title: 'Flight Boarding',
                    message: 'Gate 4',
                    category: 'FLIGHT_STATUS',
                },
            },
        ];

        (prisma.notificationDelivery.count as jest.Mock)
            .mockResolvedValueOnce(10) // totalCount
            .mockResolvedValueOnce(7)  // sentCount
            .mockResolvedValueOnce(2)  // failedCount
            .mockResolvedValueOnce(1); // pendingCount

        (prisma.notificationDelivery.findMany as jest.Mock).mockResolvedValue(mockDeliveries);

        const result = await AdminNotificationsPage();
        const clientComponent = findElement(result, AdminNotificationDeliveriesClient);

        expect(hasStaffPermission).toHaveBeenCalledWith(session, StaffPermission.NOTIFICATIONS_READ);
        expect(clientComponent).not.toBeNull();
        expect(clientComponent!.props).toMatchObject({
            initialDeliveries: mockDeliveries,
            totalCount: 10,
            sentCount: 7,
            failedCount: 2,
            pendingCount: 1,
        });
    });
});
