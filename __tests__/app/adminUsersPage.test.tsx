/** @jest-environment node */

import React from 'react';
import AdminUsersPage from '@/app/admin/users/page';
import UserRoleManagementClient from '@/components/admin/UserRoleManagementClient';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { hasStaffPermission } from '@/lib/staffAuthorization';
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
        user: {
            findMany: jest.fn(),
        },
    },
}));

jest.mock('@/components/admin/UserRoleManagementClient', () => ({
    __esModule: true,
    default: function UserRoleManagementClientMock() {
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

describe('/admin/users page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('redirects to /login if user is not authenticated', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await AdminUsersPage();

        expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('redirects to /admin if staff lacks USERS_READ permission', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'MODERATOR', staffMfaVerified: true } });
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await AdminUsersPage();

        expect(redirect).toHaveBeenCalledWith('/admin');
    });

    it('queries users and renders UserRoleManagementClient for authorized staff', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
        (hasStaffPermission as jest.Mock).mockReturnValue(true);

        const mockUsers = [
            { id: 'u1', name: 'User 1', email: 'u1@example.com', role: 'ADMIN' },
        ];
        (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

        const result = await AdminUsersPage();
        const client = findElement(result, UserRoleManagementClient);

        expect(client).not.toBeNull();
        expect(client!.props).toMatchObject({
            initialUsers: mockUsers,
        });
        expect(prisma.user.findMany).toHaveBeenCalledWith({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
            },
            orderBy: { email: 'asc' },
            take: 100,
        });
    });
});
