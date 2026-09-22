/** @jest-environment node */

import React from 'react';
import AdminDashboard from '@/app/admin/page';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

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
    it('includes navigation card for Notification Deliveries linking to /admin/notifications', async () => {
        const dashboard = await AdminDashboard();
        const links = findLinks(dashboard);

        const notificationLink = links.find(link => link.href === '/admin/notifications');
        expect(notificationLink).toBeDefined();
    });
});
