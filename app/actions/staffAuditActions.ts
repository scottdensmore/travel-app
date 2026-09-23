'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { searchStaffAuditLogs, StaffAuditQuery } from '@/lib/staffAuditService';
import { purgeExpiredAuditLogs } from '@/lib/staffAuditRetentionService';
import { assertPrivilegedStaffOperation, StaffStepUpRequiredError } from '@/lib/staffMfa';
import { revalidatePath } from 'next/cache';

export async function searchStaffAuditLogsAction(query: StaffAuditQuery) {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.AUDIT_LOGS_VIEW)) {
        return { success: false as const, error: 'Unauthorized' };
    }

    try {
        const result = await searchStaffAuditLogs(query);
        return { success: true as const, ...result };
    } catch (error) {
        return { success: false as const, error: (error as Error).message || 'Failed to search audit logs.' };
    }
}

export async function purgeExpiredAuditLogsAction(input: {
    retentionDays?: number;
    dryRun?: boolean;
    reason: string;
    stepUpCode?: string;
}) {
    const session = await getServerSession(authOptions);

    let actor;
    try {
        actor = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.AUDIT_LOGS_PURGE,
            stepUpCode: input.stepUpCode,
        });
    } catch (error) {
        if (error instanceof StaffStepUpRequiredError) {
            return { success: false as const, requiresStepUp: true as const, error: error.message };
        }
        return { success: false as const, error: (error as Error).message || 'Unauthorized' };
    }

    try {
        const result = await purgeExpiredAuditLogs({
            retentionDays: input.retentionDays,
            dryRun: input.dryRun,
            actor: { id: actor.actorId, email: actor.actorEmail, role: actor.actorRole },
            reason: input.reason,
        });
        if (!input.dryRun) {
            revalidatePath('/admin/audit');
        }
        return { success: true as const, ...result };
    } catch (error) {
        return { success: false as const, error: (error as Error).message || 'Failed to execute audit purge.' };
    }
}
