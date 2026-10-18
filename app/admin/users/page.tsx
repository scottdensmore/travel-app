import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { prisma } from '@/lib/prisma';
import UserRoleManagementClient from '@/components/admin/UserRoleManagementClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.USERS_READ)) {
        redirect(session ? '/admin' : '/login');
        return null;
    }

    const rawUsers = await prisma.user.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            pointsLedgerEntries: {
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 1,
                select: { balanceAfter: true },
            },
        },
        orderBy: { email: 'asc' },
        take: 100,
    });

    const users = rawUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        spendablePoints: u.pointsLedgerEntries?.[0]?.balanceAfter ?? 0,
    }));

    return (
        <div
            className="page-container admin p-8"
            style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}
        >
            <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link href="/admin" style={{ color: '#c084fc', textDecoration: 'none', fontWeight: '600' }} className="hover:underline">
                    ← Back to Dashboard
                </Link>
            </div>

            <UserRoleManagementClient initialUsers={users} />
        </div>
    );
}
