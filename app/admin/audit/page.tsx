import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { searchStaffAuditLogs } from '@/lib/staffAuditService';
import StaffAuditPortalClient from '@/components/admin/StaffAuditPortalClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.AUDIT_LOGS_VIEW)) {
        redirect(session ? '/admin' : '/login');
        return null;
    }

    const initialData = await searchStaffAuditLogs({ limit: 25 });

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

            <StaffAuditPortalClient
                initialLogs={initialData.logs}
                initialTotalCount={initialData.totalCount}
            />
        </div>
    );
}
