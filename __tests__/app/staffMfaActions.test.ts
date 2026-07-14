/** @jest-environment node */
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            updateMany: jest.fn(),
        },
    },
}));
jest.mock('@/lib/staffMfa', () => ({
    createStaffMfaOtpAuthUri: jest.fn(() => 'otpauth://totp/Mona'),
    decryptStaffMfaSecret: jest.fn(() => 'SECRET'),
    encryptStaffMfaSecret: jest.fn(() => 'encrypted-secret'),
    generateStaffMfaSecret: jest.fn(() => 'SECRET'),
    verifyStaffTotpCode: jest.fn(() => 123),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { verifyStaffTotpCode } from '@/lib/staffMfa';
import {
    beginStaffMfaEnrollment,
    confirmStaffMfaEnrollment,
} from '@/app/staff/mfa/actions';

const session = {
    user: {
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        staffMfaVerified: false,
        staffMfaEnrollmentRequired: true,
    },
};

describe('staff MFA enrollment actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getServerSession as jest.Mock).mockResolvedValue(session);
        (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        (verifyStaffTotpCode as jest.Mock).mockReturnValue(123);
    });

    it('rejects non-admin and already-verified sessions', async () => {
        (getServerSession as jest.Mock).mockResolvedValueOnce({
            user: { ...session.user, role: 'USER' },
        });
        await expect(beginStaffMfaEnrollment()).rejects.toThrow(
            'Staff MFA enrollment is not available.'
        );

        (getServerSession as jest.Mock).mockResolvedValueOnce({
            user: { ...session.user, staffMfaVerified: true },
        });
        await expect(beginStaffMfaEnrollment()).rejects.toThrow(
            'Staff MFA enrollment is not available.'
        );
    });

    it('stores an encrypted pending secret and returns authenticator setup data', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            email: 'admin@example.com',
            staffMfaEnrolledAt: null,
        });

        await expect(beginStaffMfaEnrollment()).resolves.toEqual({
            manualKey: 'SECRET',
            otpAuthUri: 'otpauth://totp/Mona',
        });
        expect(prisma.user.updateMany).toHaveBeenCalledWith({
            where: { id: 'admin-1', staffMfaEnrolledAt: null },
            data: {
                staffMfaSecretEncrypted: 'encrypted-secret',
                staffMfaLastUsedStep: null,
            },
        });
    });

    it('rejects an invalid authenticator code without enrolling the account', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            staffMfaSecretEncrypted: 'encrypted-secret',
            staffMfaEnrolledAt: null,
        });
        (verifyStaffTotpCode as jest.Mock).mockReturnValue(null);

        await expect(confirmStaffMfaEnrollment('123456')).resolves.toEqual({
            ok: false,
            error: 'That code is invalid or expired.',
        });
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('enrolls atomically and invalidates the limited setup session', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            staffMfaSecretEncrypted: 'encrypted-secret',
            staffMfaEnrolledAt: null,
        });

        await expect(confirmStaffMfaEnrollment('123456')).resolves.toEqual({ ok: true });
        expect(prisma.user.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'admin-1',
                staffMfaSecretEncrypted: 'encrypted-secret',
                staffMfaEnrolledAt: null,
            },
            data: {
                staffMfaEnrolledAt: expect.any(Date),
                staffMfaLastUsedStep: 123,
                authVersion: { increment: 1 },
            },
        });
    });
});
