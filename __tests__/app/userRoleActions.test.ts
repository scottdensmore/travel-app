/** @jest-environment node */
import { adjustUserPointsAction } from '@/app/actions/userRoleActions';
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
