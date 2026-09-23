import { prisma } from './prisma';
import { Role } from '@prisma/client';
import { recordStaffAudit } from './staffAuditService';
import logger from './logger';

export interface AuditRetentionPurgeResult {
    dryRun: boolean;
    eligibleCount?: number;
    deletedCount?: number;
    cutoffDate: Date;
}

export async function purgeExpiredAuditLogs(options: {
    retentionDays?: number;
    dryRun?: boolean;
    actor: { id: string; email: string; role: Role };
    reason: string;
}): Promise<AuditRetentionPurgeResult> {
    const retentionDays = options.retentionDays ?? 365;
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
        throw new Error('retentionDays must be a positive integer.');
    }
    const dryRun = options.dryRun ?? true;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const eligibleCount = await prisma.staffAuditLog.count({
        where: { createdAt: { lt: cutoffDate } },
    });

    if (dryRun) {
        return {
            dryRun: true,
            eligibleCount,
            cutoffDate,
        };
    }

    return prisma.$transaction(async (tx) => {
        const deleteResult = await tx.staffAuditLog.deleteMany({
            where: { createdAt: { lt: cutoffDate } },
        });

        await recordStaffAudit({
            actorId: options.actor.id,
            actorEmail: options.actor.email,
            actorRole: options.actor.role,
            action: 'AUDIT_RETENTION_PURGE',
            targetType: 'StaffAuditLog',
            targetId: 'BULK',
            reason: options.reason,
            metadata: {
                deletedCount: deleteResult.count,
                retentionDays,
                cutoffDate: cutoffDate.toISOString(),
            },
        }, tx);

        logger.warn('Staff audit retention purge executed', {
            deletedCount: deleteResult.count,
            retentionDays,
            cutoffDate,
            actor: options.actor.email,
        });

        return {
            dryRun: false,
            deletedCount: deleteResult.count,
            cutoffDate,
        };
    });
}
