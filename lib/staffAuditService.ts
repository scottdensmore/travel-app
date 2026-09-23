import { prisma } from './prisma';
import { Prisma, Role, StaffAuditLog } from '@prisma/client';
import { parseInput, staffAuditInputSchema, staffAuditQuerySchema } from './validation';
import logger from './logger';

export interface StaffAuditInput {
    actorId: string;
    actorEmail: string;
    actorRole: Role;
    action: string;
    targetType: string;
    targetId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
}

export async function recordStaffAudit(
    entry: StaffAuditInput,
    tx?: Prisma.TransactionClient
): Promise<StaffAuditLog> {
    const validated = parseInput(staffAuditInputSchema, entry);
    const client = tx ?? prisma;

    const auditLog = await client.staffAuditLog.create({
        data: {
            actorId: validated.actorId,
            actorEmail: validated.actorEmail,
            actorRole: validated.actorRole,
            action: validated.action,
            targetType: validated.targetType,
            targetId: validated.targetId,
            beforeState: (validated.beforeState as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            afterState: (validated.afterState as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            reason: validated.reason ?? null,
            metadata: (validated.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            ipAddress: validated.ipAddress ?? null,
        },
    });

    logger.info(`Staff audit recorded: ${validated.action}`, {
        auditId: auditLog.id,
        actorEmail: validated.actorEmail,
        action: validated.action,
        targetType: validated.targetType,
        targetId: validated.targetId,
    });

    return auditLog;
}

export interface StaffAuditQuery {
    dateFrom?: string | Date;
    dateTo?: string | Date;
    actorId?: string;
    actorEmail?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    limit?: number;
    cursor?: string;
}

export async function searchStaffAuditLogs(query: StaffAuditQuery) {
    const validated = parseInput(staffAuditQuerySchema, query);
    const where: Prisma.StaffAuditLogWhereInput = {};

    if (validated.actorId) where.actorId = validated.actorId;
    if (validated.actorEmail) where.actorEmail = { contains: validated.actorEmail, mode: 'insensitive' };
    if (validated.action && validated.action !== 'ALL') where.action = validated.action;
    if (validated.targetType) where.targetType = validated.targetType;
    if (validated.targetId) where.targetId = validated.targetId;

    if (validated.dateFrom || validated.dateTo) {
        where.createdAt = {};
        if (validated.dateFrom) where.createdAt.gte = new Date(validated.dateFrom);
        if (validated.dateTo) where.createdAt.lte = new Date(validated.dateTo);
    }

    const limit = validated.limit ?? 25;
    const [totalCount, logs] = await Promise.all([
        prisma.staffAuditLog.count({ where }),
        prisma.staffAuditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            cursor: validated.cursor ? { id: validated.cursor } : undefined,
            skip: validated.cursor ? 1 : undefined,
            include: { actor: { select: { name: true, image: true } } },
        }),
    ]);

    const hasNextPage = logs.length > limit;
    const results = hasNextPage ? logs.slice(0, limit) : logs;
    const nextCursor = hasNextPage ? results[results.length - 1]?.id : null;

    return {
        logs: results,
        totalCount,
        hasNextPage,
        nextCursor,
    };
}
