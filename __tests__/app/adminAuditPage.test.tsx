/** @jest-environment node */

import React from 'react';
import AdminAuditPage from '@/app/admin/audit/page';
import StaffAuditPortalClient from '@/components/admin/StaffAuditPortalClient';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { searchStaffAuditLogs } from '@/lib/staffAuditService';

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

jest.mock('@/lib/staffAuditService', () => ({
    searchStaffAuditLogs: jest.fn(),
}));

jest.mock('@/components/admin/StaffAuditPortalClient', () => ({
    __esModule: true,
    default: function StaffAuditPortalClientMock() {
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

describe('/admin/audit page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('redirects to /login if user is not authenticated or authorized', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await AdminAuditPage();

        expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('redirects to /admin if authenticated staff lacks AUDIT_LOGS_VIEW', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'SUPPORT', staffMfaVerified: true } });
        (hasStaffPermission as jest.Mock).mockReturnValue(false);

        await AdminAuditPage();

        expect(redirect).toHaveBeenCalledWith('/admin');
    });

    it('fetches initial audit logs and renders StaffAuditPortalClient for authorized staff', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
        (hasStaffPermission as jest.Mock).mockReturnValue(true);

        const mockLogs = [
            { id: 'log-1', action: 'USER_ROLE_UPDATE', actorEmail: 'admin@example.com' },
        ];
        (searchStaffAuditLogs as jest.Mock).mockResolvedValue({
            logs: mockLogs,
            totalCount: 1,
        });

        const result = await AdminAuditPage();
        const client = findElement(result, StaffAuditPortalClient);

        expect(client).not.toBeNull();
        expect(client!.props).toMatchObject({
            initialLogs: mockLogs,
            initialTotalCount: 1,
        });
    });
});
