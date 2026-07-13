/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), update: jest.fn() },
    }
}));
jest.mock('@/lib/authTokens', () => ({
    issueAuthToken: jest.fn(),
    consumeAuthToken: jest.fn(),
    hasUsableAuthToken: jest.fn(),
}));
jest.mock('@/lib/authEmail', () => ({
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { consumeAuthToken, hasUsableAuthToken, issueAuthToken } from '@/lib/authTokens';
import { sendPasswordResetEmail, sendVerificationEmail } from '@/lib/authEmail';
import {
    requestEmailVerification,
    requestPasswordReset,
    resetPassword,
    verifyEmail,
} from '@/lib/authAccountFlows';

const mockedPrisma = prisma as unknown as {
    user: { findUnique: jest.Mock; update: jest.Mock };
};

describe('authentication account flows', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (issueAuthToken as jest.Mock).mockResolvedValue('raw-token');
        (hasUsableAuthToken as jest.Mock).mockResolvedValue(true);
        (bcrypt.hash as jest.Mock).mockResolvedValue('new-password-hash');
    });

    it('issues a 24-hour verification token only for an unverified account', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({ emailVerified: null });

        await requestEmailVerification(' ADA@Example.com ');

        expect(issueAuthToken).toHaveBeenCalledWith('verify-email', 'ada@example.com', 24 * 60 * 60);
        expect(sendVerificationEmail).toHaveBeenCalledWith('ada@example.com', 'raw-token');

        jest.clearAllMocks();
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        await requestEmailVerification('unknown@example.com');
        expect(issueAuthToken).not.toHaveBeenCalled();
        expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('issues a one-hour reset token only for a verified password account', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({
            password: 'current-hash', emailVerified: new Date()
        });

        await requestPasswordReset('ada@example.com');

        expect(issueAuthToken).toHaveBeenCalledWith('reset-password', 'ada@example.com', 60 * 60);
        expect(sendPasswordResetEmail).toHaveBeenCalledWith('ada@example.com', 'raw-token');

        jest.clearAllMocks();
        mockedPrisma.user.findUnique.mockResolvedValue({ password: 'hash', emailVerified: null });
        await requestPasswordReset('unverified@example.com');
        expect(issueAuthToken).not.toHaveBeenCalled();
    });

    it('verifies an email inside the one-time-token transaction', async () => {
        (consumeAuthToken as jest.Mock).mockImplementation(async (_purpose, _token, operation) =>
            operation(mockedPrisma, 'ada@example.com')
        );
        mockedPrisma.user.update.mockResolvedValue({});

        await expect(verifyEmail('raw-token')).resolves.toBe(true);

        expect(consumeAuthToken).toHaveBeenCalledWith(
            'verify-email',
            'raw-token',
            expect.any(Function)
        );
        expect(mockedPrisma.user.update).toHaveBeenCalledWith({
            where: { email: 'ada@example.com' },
            data: { emailVerified: expect.any(Date) },
        });
    });

    it('changes the password and increments the auth version atomically', async () => {
        (consumeAuthToken as jest.Mock).mockImplementation(async (_purpose, _token, operation) =>
            operation(mockedPrisma, 'ada@example.com')
        );
        mockedPrisma.user.update.mockResolvedValue({});

        await expect(resetPassword('raw-token', 'NewPassword123!')).resolves.toBe(true);

        expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword123!', 10);
        expect(mockedPrisma.user.update).toHaveBeenCalledWith({
            where: { email: 'ada@example.com' },
            data: {
                password: 'new-password-hash',
                authVersion: { increment: 1 },
            },
        });
    });

    it('returns false without updating when a token is invalid or already used', async () => {
        (consumeAuthToken as jest.Mock).mockResolvedValue(null);

        await expect(verifyEmail('invalid-token')).resolves.toBe(false);
        expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects random reset tokens before performing bcrypt work', async () => {
        (hasUsableAuthToken as jest.Mock).mockResolvedValue(false);

        await expect(resetPassword('invalid-token', 'NewPassword123!')).resolves.toBe(false);

        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(consumeAuthToken).not.toHaveBeenCalled();
    });
});
