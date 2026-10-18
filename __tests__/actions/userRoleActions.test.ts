import { updateUserRoleAction, adjustUserPointsAction } from '@/app/actions/userRoleActions';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import * as staffMfaModule from '@/lib/staffMfa';
import { PointsTransactionType } from '@prisma/client';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));
jest.mock('@/lib/staffMfa', () => {
    const actual = jest.requireActual('@/lib/staffMfa');
    return {
        ...actual,
        verifyAndConsumeStaffTotp: jest.fn(),
    };
});
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        pointsLedgerEntry: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
        staffAuditLog: {
            create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
        $transaction: jest.fn(callback => callback(prisma)),
    },
}));

describe('updateUserRoleAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects unauthorized users lacking USERS_MANAGE_ROLES', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'u1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
        });

        const result = await updateUserRoleAction({
            userId: 'target-1',
            newRole: 'ADMIN',
            reason: 'Promotion',
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/unauthorized/i);
    });

    it('requires step-up TOTP code for role modifications', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        });

        const result = await updateUserRoleAction({
            userId: 'target-1',
            newRole: 'SUPPORT',
            reason: 'New team member',
        });

        expect(result.success).toBe(false);
        expect(result.requiresStepUp).toBe(true);
    });

    it('updates user role, increments authVersion, and records audit on valid step-up code', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        });

        (prisma.user.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'admin1', staffMfaSecretEncrypted: 'enc-secret' })
            .mockResolvedValueOnce({ id: 'target-1', email: 'target@example.com', role: 'USER', authVersion: 2 });

        (staffMfaModule.verifyAndConsumeStaffTotp as jest.Mock).mockResolvedValue(true);
        (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'target-1', role: 'SUPPORT', authVersion: 3 });

        const result = await updateUserRoleAction({
            userId: 'target-1',
            newRole: 'SUPPORT',
            reason: 'Promoted to support',
            stepUpCode: '123456',
        });

        expect(result.success).toBe(true);
        expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'target-1' },
            data: expect.objectContaining({ role: 'SUPPORT', authVersion: { increment: 1 } }),
        }));
        expect(prisma.staffAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'USER_ROLE_UPDATE',
                targetType: 'User',
                targetId: 'target-1',
                beforeState: { role: 'USER', email: 'target@example.com' },
                afterState: { role: 'SUPPORT', email: 'target@example.com' },
                reason: 'Promoted to support',
            }),
        }));
    });

    it('rejects invalid inputs before reaching auth or database', async () => {
        const result = await updateUserRoleAction({
            userId: '',
            newRole: 'INVALID_ROLE' as never,
            reason: '',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    it('returns error when target user is not found', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        });

        (prisma.user.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'admin1', staffMfaSecretEncrypted: 'enc-secret' })
            .mockResolvedValueOnce(null);

        (staffMfaModule.verifyAndConsumeStaffTotp as jest.Mock).mockResolvedValue(true);

        const result = await updateUserRoleAction({
            userId: 'nonexistent-user',
            newRole: 'SUPPORT',
            reason: 'Promoted to support',
            stepUpCode: '123456',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('User not found.');
    });
});

describe('adjustUserPointsAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects invalid inputs (zero amount, empty reason, excessive delta)', async () => {
        const zeroResult = await adjustUserPointsAction({
            userId: 'target-1',
            amount: 0,
            reason: 'Goodwill',
        });
        expect(zeroResult.success).toBe(false);
        expect(zeroResult.error).toMatch(/cannot be zero/i);

        const hugeResult = await adjustUserPointsAction({
            userId: 'target-1',
            amount: 2_000_000,
            reason: 'Too many points',
        });
        expect(hugeResult.success).toBe(false);
        expect(hugeResult.error).toMatch(/1,000,000/i);
    });

    it('requires step-up TOTP code for points adjustments', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'support1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
        });

        const result = await adjustUserPointsAction({
            userId: 'target-1',
            amount: 5000,
            reason: 'Service recovery goodwill credit',
        });

        expect(result.success).toBe(false);
        expect(result.requiresStepUp).toBe(true);
    });

    it('creates ADMIN_ADJUSTMENT ledger entry and records staff audit on valid step-up code', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'support1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
        });

        (prisma.user.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'support1', staffMfaSecretEncrypted: 'enc-secret' })
            .mockResolvedValueOnce({ id: 'target-1', email: 'target@example.com' });

        (staffMfaModule.verifyAndConsumeStaffTotp as jest.Mock).mockResolvedValue(true);
        (prisma.pointsLedgerEntry.findFirst as jest.Mock).mockResolvedValue({ balanceAfter: 10000 });
        (prisma.pointsLedgerEntry.create as jest.Mock).mockResolvedValue({
            id: 'entry-1',
            userId: 'target-1',
            type: PointsTransactionType.ADMIN_ADJUSTMENT,
            amount: 5000,
            balanceAfter: 15000,
            description: 'Admin adjustment: Service recovery goodwill credit',
        });

        const result = await adjustUserPointsAction({
            userId: 'target-1',
            amount: 5000,
            reason: 'Service recovery goodwill credit',
            stepUpCode: '123456',
        });

        expect(result).toEqual({
            success: true,
            balanceAfter: 15000,
        });
        expect(prisma.pointsLedgerEntry.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: 'target-1',
                type: PointsTransactionType.ADMIN_ADJUSTMENT,
                amount: 5000,
                balanceAfter: 15000,
                description: 'Admin adjustment: Service recovery goodwill credit',
            }),
        });
        expect(prisma.staffAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'USER_POINTS_ADJUSTMENT',
                targetType: 'User',
                targetId: 'target-1',
                beforeState: { spendablePoints: 10000, email: 'target@example.com' },
                afterState: { spendablePoints: 15000, delta: 5000, email: 'target@example.com' },
                reason: 'Service recovery goodwill credit',
            }),
        }));
    });

    it('returns InsufficientPointsError message when negative adjustment exceeds user balance', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
        });

        (prisma.user.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'admin1', staffMfaSecretEncrypted: 'enc-secret' })
            .mockResolvedValueOnce({ id: 'target-1', email: 'target@example.com' });

        (staffMfaModule.verifyAndConsumeStaffTotp as jest.Mock).mockResolvedValue(true);
        (prisma.pointsLedgerEntry.findFirst as jest.Mock).mockResolvedValue({ balanceAfter: 1000 });

        const result = await adjustUserPointsAction({
            userId: 'target-1',
            amount: -2500,
            reason: 'Clawback duplicate bonus',
            stepUpCode: '123456',
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/insufficient reward points/i);
        expect(prisma.pointsLedgerEntry.create).not.toHaveBeenCalled();
    });
});

