import { updateUserRoleAction } from '@/app/actions/userRoleActions';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
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
