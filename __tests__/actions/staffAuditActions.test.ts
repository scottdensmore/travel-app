import { searchStaffAuditLogsAction, purgeExpiredAuditLogsAction } from '@/app/actions/staffAuditActions';
import { getServerSession } from 'next-auth';
import { StaffPermission } from '@/lib/staffPermissions';
import * as staffAuditService from '@/lib/staffAuditService';
import * as staffAuditRetentionService from '@/lib/staffAuditRetentionService';
import * as staffMfaModule from '@/lib/staffMfa';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({
    prisma: {},
}));
jest.mock('@/lib/staffMfa', () => {
    const actual = jest.requireActual('@/lib/staffMfa');
    return {
        ...actual,
        assertPrivilegedStaffOperation: jest.fn(actual.assertPrivilegedStaffOperation),
    };
});
jest.mock('@/lib/staffAuditService');
jest.mock('@/lib/staffAuditRetentionService');

describe('staffAuditActions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('searchStaffAuditLogsAction', () => {
        it('rejects unauthenticated users or users lacking AUDIT_LOGS_VIEW', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            const res1 = await searchStaffAuditLogsAction({});
            expect(res1.success).toBe(false);
            expect(res1.error).toMatch(/unauthorized/i);

            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'm1', email: 'mod@example.com', role: 'MODERATOR', staffMfaVerified: true },
            });
            const res2 = await searchStaffAuditLogsAction({});
            expect(res2.success).toBe(false);
            expect(res2.error).toMatch(/unauthorized/i);
        });

        it('returns search results for authorized staff', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            });
            (staffAuditService.searchStaffAuditLogs as jest.Mock).mockResolvedValue({
                logs: [{ id: 'log-1', action: 'TEST' }],
                totalCount: 1,
                hasNextPage: false,
                nextCursor: null,
            });

            const res = await searchStaffAuditLogsAction({ limit: 10 });
            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.logs).toHaveLength(1);
                expect(res.totalCount).toBe(1);
            }
        });

        it('handles search service errors gracefully', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            });
            (staffAuditService.searchStaffAuditLogs as jest.Mock).mockRejectedValue(
                new Error('Database timeout')
            );

            const res = await searchStaffAuditLogsAction({ limit: 10 });
            expect(res.success).toBe(false);
            expect(res.error).toBe('Database timeout');
        });
    });

    describe('purgeExpiredAuditLogsAction', () => {
        it('rejects users lacking AUDIT_LOGS_PURGE', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'op1', email: 'op@example.com', role: 'OPERATIONS', staffMfaVerified: true },
            });
            const res = await purgeExpiredAuditLogsAction({ reason: 'Purge test' });
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/unauthorized/i);
        });

        it('requires step-up code when not within step-up window', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            });
            (staffMfaModule.assertPrivilegedStaffOperation as jest.Mock).mockRejectedValue(
                new staffMfaModule.StaffStepUpRequiredError(StaffPermission.AUDIT_LOGS_PURGE)
            );

            const res = await purgeExpiredAuditLogsAction({ reason: 'Purge test' });
            expect(res.success).toBe(false);
            expect(res.requiresStepUp).toBe(true);
        });

        it('executes purge when step-up succeeds', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            });
            (staffMfaModule.assertPrivilegedStaffOperation as jest.Mock).mockResolvedValue({
                actorId: 'admin1',
                actorEmail: 'admin@example.com',
                actorRole: 'ADMIN',
            });
            (staffAuditRetentionService.purgeExpiredAuditLogs as jest.Mock).mockResolvedValue({
                dryRun: false,
                deletedCount: 15,
                cutoffDate: new Date(),
            });

            const res = await purgeExpiredAuditLogsAction({
                retentionDays: 365,
                dryRun: false,
                reason: 'Routine compliance retention purge',
                stepUpCode: '123456',
            });

            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.deletedCount).toBe(15);
            }
        });

        it('returns count preview without revalidating path in dry-run mode', async () => {
            const { revalidatePath } = require('next/cache');
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            });
            (staffMfaModule.assertPrivilegedStaffOperation as jest.Mock).mockResolvedValue({
                actorId: 'admin1',
                actorEmail: 'admin@example.com',
                actorRole: 'ADMIN',
            });
            (staffAuditRetentionService.purgeExpiredAuditLogs as jest.Mock).mockResolvedValue({
                dryRun: true,
                eligibleCount: 8,
                cutoffDate: new Date(),
            });

            const res = await purgeExpiredAuditLogsAction({
                retentionDays: 365,
                dryRun: true,
                reason: 'Dry run preview',
                stepUpCode: '123456',
            });

            expect(res.success).toBe(true);
            if (res.success) {
                expect(res.dryRun).toBe(true);
                expect(res.eligibleCount).toBe(8);
            }
            expect(revalidatePath).not.toHaveBeenCalled();
        });

        it('handles purge service errors gracefully', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            });
            (staffMfaModule.assertPrivilegedStaffOperation as jest.Mock).mockResolvedValue({
                actorId: 'admin1',
                actorEmail: 'admin@example.com',
                actorRole: 'ADMIN',
            });
            (staffAuditRetentionService.purgeExpiredAuditLogs as jest.Mock).mockRejectedValue(
                new Error('Purge failed')
            );

            const res = await purgeExpiredAuditLogsAction({
                reason: 'Purge test',
                stepUpCode: '123456',
            });
            expect(res.success).toBe(false);
            expect(res.error).toBe('Purge failed');
        });
    });
});
