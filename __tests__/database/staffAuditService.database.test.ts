/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { recordStaffAudit, searchStaffAuditLogs } from '@/lib/staffAuditService';
import { purgeExpiredAuditLogs } from '@/lib/staffAuditRetentionService';

describe('Staff Audit and Retention Service Database Integration', () => {
    const createdAuditIds: string[] = [];
    const createdUserIds: string[] = [];

    afterAll(async () => {
        if (createdAuditIds.length > 0) {
            await prisma.staffAuditLog.deleteMany({
                where: { id: { in: createdAuditIds } },
            });
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
        await prisma.$disconnect();
    });

    it('records and queries audit logs with structured diffs', async () => {
        const actor = await prisma.user.create({
            data: {
                email: `auditor-${randomUUID()}@example.com`,
                name: 'Auditor User',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(actor.id);

        const audit1 = await recordStaffAudit({
            actorId: actor.id,
            actorEmail: actor.email!,
            actorRole: 'ADMIN',
            action: 'USER_ROLE_UPDATE',
            targetType: 'User',
            targetId: 'target-123',
            beforeState: { role: 'USER' },
            afterState: { role: 'SUPPORT' },
            reason: 'Customer service onboarding',
        });
        createdAuditIds.push(audit1.id);

        const searchResult = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            action: 'USER_ROLE_UPDATE',
            limit: 10,
        });

        expect(searchResult.logs).toHaveLength(1);
        expect(searchResult.logs[0].id).toBe(audit1.id);
        expect(searchResult.logs[0].beforeState).toEqual({ role: 'USER' });
        expect(searchResult.logs[0].afterState).toEqual({ role: 'SUPPORT' });
    });

    it('accurately previews and purges records older than retention cutoff with self-audit', async () => {
        const actor = await prisma.user.create({
            data: {
                email: `purge-admin-${randomUUID()}@example.com`,
                name: 'Purge Admin',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(actor.id);

        // Create an old audit log (400 days old)
        const oldLog = await prisma.staffAuditLog.create({
            data: {
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'ADMIN',
                action: 'LEGACY_ACTION',
                targetType: 'LegacyTarget',
                targetId: '999',
                createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
            },
        });
        createdAuditIds.push(oldLog.id);

        // Dry-run preview
        const dryRunResult = await purgeExpiredAuditLogs({
            retentionDays: 365,
            dryRun: true,
            actor: { id: actor.id, email: actor.email!, role: 'ADMIN' },
            reason: 'Testing dry run purge',
        });

        expect(dryRunResult.dryRun).toBe(true);
        expect(dryRunResult.eligibleCount).toBeGreaterThanOrEqual(1);

        // Live purge
        const livePurgeResult = await purgeExpiredAuditLogs({
            retentionDays: 365,
            dryRun: false,
            actor: { id: actor.id, email: actor.email!, role: 'ADMIN' },
            reason: 'Annual compliance retention purge',
        });

        expect(livePurgeResult.dryRun).toBe(false);
        expect(livePurgeResult.deletedCount).toBeGreaterThanOrEqual(1);

        // Verify oldLog is gone
        const fetchedOld = await prisma.staffAuditLog.findUnique({ where: { id: oldLog.id } });
        expect(fetchedOld).toBeNull();

        // Verify the purge itself created a StaffAuditLog entry
        const purgeAudit = await prisma.staffAuditLog.findFirst({
            where: { action: 'AUDIT_RETENTION_PURGE', actorEmail: actor.email! },
        });
        expect(purgeAudit).not.toBeNull();
        if (purgeAudit) createdAuditIds.push(purgeAudit.id);
        expect(purgeAudit?.reason).toBe('Annual compliance retention purge');
    });

    it('writes audit logs within a transaction client and rolls back on failure', async () => {
        const actor = await prisma.user.create({
            data: {
                email: `tx-admin-${randomUUID()}@example.com`,
                name: 'Tx Admin',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(actor.id);

        let committedAuditId = '';
        await prisma.$transaction(async (tx) => {
            const audit = await recordStaffAudit({
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'ADMIN',
                action: 'TX_COMMITTED_ACTION',
                targetType: 'FlightSchedule',
                targetId: 'sched-100',
                reason: 'Transactional update test',
            }, tx);
            committedAuditId = audit.id;
            createdAuditIds.push(audit.id);
        });

        const foundCommitted = await prisma.staffAuditLog.findUnique({
            where: { id: committedAuditId },
        });
        expect(foundCommitted).not.toBeNull();
        expect(foundCommitted?.action).toBe('TX_COMMITTED_ACTION');

        // Rollback test: transaction throws
        let attemptedAuditId = '';
        await expect(prisma.$transaction(async (tx) => {
            const audit = await recordStaffAudit({
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'ADMIN',
                action: 'TX_ROLLEDBACK_ACTION',
                targetType: 'FlightSchedule',
                targetId: 'sched-101',
            }, tx);
            attemptedAuditId = audit.id;
            throw new Error('Simulated transaction rollback');
        })).rejects.toThrow('Simulated transaction rollback');

        const foundRolledback = await prisma.staffAuditLog.findUnique({
            where: { id: attemptedAuditId },
        });
        expect(foundRolledback).toBeNull();
    });

    it('supports advanced query filtering, date ranges, and cursor pagination', async () => {
        const actor = await prisma.user.create({
            data: {
                email: `query-tester-${randomUUID()}@example.com`,
                name: 'Query Tester',
                role: 'OPERATIONS',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(actor.id);

        const baseTime = Date.now();
        // Create 3 distinct audit entries
        const audit1 = await prisma.staffAuditLog.create({
            data: {
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'OPERATIONS',
                action: 'ACTION_ALPHA',
                targetType: 'Booking',
                targetId: 'bk-1',
                createdAt: new Date(baseTime - 30_000),
            },
        });
        const audit2 = await prisma.staffAuditLog.create({
            data: {
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'OPERATIONS',
                action: 'ACTION_BETA',
                targetType: 'Booking',
                targetId: 'bk-2',
                createdAt: new Date(baseTime - 20_000),
            },
        });
        const audit3 = await prisma.staffAuditLog.create({
            data: {
                actorId: actor.id,
                actorEmail: actor.email!,
                actorRole: 'OPERATIONS',
                action: 'ACTION_BETA',
                targetType: 'FlightSchedule',
                targetId: 'sch-3',
                createdAt: new Date(baseTime - 10_000),
            },
        });
        createdAuditIds.push(audit1.id, audit2.id, audit3.id);

        // 1. Query by action: 'ALL' returns all actions for actor
        const allActionResult = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            action: 'ALL',
        });
        expect(allActionResult.logs).toHaveLength(3);
        expect(allActionResult.totalCount).toBe(3);

        // 2. Query by targetType and targetId
        const targetResult = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            targetType: 'Booking',
            targetId: 'bk-1',
        });
        expect(targetResult.logs).toHaveLength(1);
        expect(targetResult.logs[0].id).toBe(audit1.id);

        // 3. Query with dateFrom and dateTo
        const dateRangeResult = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            dateFrom: new Date(baseTime - 25_000),
            dateTo: new Date(baseTime - 5_000),
        });
        expect(dateRangeResult.logs).toHaveLength(2);
        expect(dateRangeResult.logs.map(l => l.id)).toEqual([audit3.id, audit2.id]);

        // 4. Cursor pagination: page 1 with limit: 2
        const page1 = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            limit: 2,
        });
        expect(page1.logs).toHaveLength(2);
        expect(page1.hasNextPage).toBe(true);
        expect(page1.nextCursor).toBe(audit2.id);

        // Page 2 using nextCursor
        const page2 = await searchStaffAuditLogs({
            actorEmail: actor.email!,
            limit: 2,
            cursor: page1.nextCursor!,
        });
        expect(page2.logs).toHaveLength(1);
        expect(page2.logs[0].id).toBe(audit1.id);
        expect(page2.hasNextPage).toBe(false);
        expect(page2.nextCursor).toBeNull();
    });

    it('validates input and rejects invalid audit records', async () => {
        await expect(recordStaffAudit({
            actorId: '',
            actorEmail: 'invalid-email',
            actorRole: 'INVALID_ROLE' as never,
            action: '',
            targetType: '',
            targetId: '',
        })).rejects.toThrow();
    });

});
