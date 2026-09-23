/** @jest-environment node */

import React from 'react';
import { getServerSession } from 'next-auth';
import AdminDashboard from '@/app/admin/page';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: { count: jest.fn().mockResolvedValue(10) },
        booking: { count: jest.fn().mockResolvedValue(5), findMany: jest.fn().mockResolvedValue([]) },
        cityGuide: { count: jest.fn().mockResolvedValue(3) },
    },
}));

function findLinks(node: unknown): Array<{ href: string; children?: React.ReactNode }> {
    if (!React.isValidElement(node)) return [];
    const links: Array<{ href: string; children?: React.ReactNode }> = [];
    if (node.type === Link) {
        links.push({
            href: (node.props as { href: string }).href,
            children: (node.props as { children?: React.ReactNode }).children,
        });
    }
    const children = React.Children.toArray(
        (node.props as { children?: React.ReactNode }).children
    );
    for (const child of children) {
        links.push(...findLinks(child));
    }
    return links;
}

describe('AdminDashboard navigation cards', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders all navigation cards for verified ADMIN role', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { role: 'ADMIN', staffMfaVerified: true },
        });

        const dashboard = await AdminDashboard();
        const links = findLinks(dashboard);
        const hrefs = links.map(l => l.href);

        expect(hrefs).toContain('/admin/travelguide');
        expect(hrefs).toContain('/admin/flights');
        expect(hrefs).toContain('/admin/payments');
        expect(hrefs).toContain('/admin/bookings');
        expect(hrefs).toContain('/admin/reviews');
        expect(hrefs).toContain('/admin/notifications');
        expect(hrefs).toContain('/admin/users');
        expect(hrefs).toContain('/admin/audit');
    });

    it('filters navigation cards based on MODERATOR role permissions', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { role: 'MODERATOR', staffMfaVerified: true },
        });

        const dashboard = await AdminDashboard();
        const links = findLinks(dashboard);
        const hrefs = links.map(l => l.href);

        expect(hrefs).toContain('/admin/travelguide');
        expect(hrefs).toContain('/admin/reviews');
        expect(hrefs).not.toContain('/admin/users');
        expect(hrefs).not.toContain('/admin/audit');
        expect(hrefs).not.toContain('/admin/flights');
        expect(hrefs).not.toContain('/admin/bookings');
    });

    it('filters navigation cards for SUPPORT role permissions', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { role: 'SUPPORT', staffMfaVerified: true },
        });

        const dashboard = await AdminDashboard();
        const links = findLinks(dashboard);
        const hrefs = links.map(l => l.href);

        expect(hrefs).toContain('/admin/bookings');
        expect(hrefs).toContain('/admin/notifications');
        expect(hrefs).toContain('/admin/payments');
        expect(hrefs).not.toContain('/admin/users');
        expect(hrefs).not.toContain('/admin/audit');
        expect(hrefs).not.toContain('/admin/flights');
    });
});
