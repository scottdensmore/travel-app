import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';
import { prisma } from '@/lib/prisma';
import AdminNotificationDeliveriesClient from '@/components/admin/AdminNotificationDeliveriesClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage() {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) {
        redirect('/login');
    }

    const [totalCount, sentCount, failedCount, pendingCount, initialDeliveries] = await Promise.all([
        prisma.notificationDelivery.count(),
        prisma.notificationDelivery.count({ where: { status: 'SENT' } }),
        prisma.notificationDelivery.count({ where: { status: 'FAILED' } }),
        prisma.notificationDelivery.count({ where: { status: 'PENDING' } }),
        prisma.notificationDelivery.findMany({
            take: 50,
            orderBy: { createdAt: 'desc' },
            include: { notification: true },
        }),
    ]);

    return (
        <div
            className="page-container admin p-8"
            style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}
        >
            <div className="flex justify-between items-center">
                <div>
                    <Link href="/admin" className="text-purple-400 font-semibold hover:underline">
                        ← Back to Dashboard
                    </Link>
                    <h1 className="text-3xl font-bold text-white mt-2">Notification Delivery Portal</h1>
                </div>
            </div>

            <AdminNotificationDeliveriesClient
                initialDeliveries={initialDeliveries}
                totalCount={totalCount}
                sentCount={sentCount}
                failedCount={failedCount}
                pendingCount={pendingCount}
            />
        </div>
    );
}
