/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        verificationToken: {
            deleteMany: jest.fn(),
            create: jest.fn(),
            findUnique: jest.fn(),
        },
        $transaction: jest.fn(),
        $executeRaw: jest.fn(),
    }
}));

import {
    consumeAuthToken,
    createAuthTokenDigest,
    hasUsableAuthToken,
    issueAuthToken,
    pruneExpiredAuthTokens,
} from '@/lib/authTokens';
import { prisma } from '@/lib/prisma';
import { isValidAuthToken } from '@/lib/authTokenFormat';

const mockedPrisma = prisma as unknown as {
    verificationToken: {
        deleteMany: jest.Mock;
        create: jest.Mock;
        findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
};

describe('one-time authentication tokens', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedPrisma.$transaction.mockImplementation(async (operation: (client: typeof mockedPrisma) => unknown) =>
            operation(mockedPrisma)
        );
    });

    it('accepts only the expected URL-safe 43-character token shape', () => {
        expect(isValidAuthToken('a'.repeat(43))).toBe(true);
        expect(isValidAuthToken('A0_-'.repeat(10) + 'abc')).toBe(true);
        expect(isValidAuthToken('x')).toBe(false);
        expect(isValidAuthToken('a'.repeat(42))).toBe(false);
        expect(isValidAuthToken(`${'a'.repeat(42)}!`)).toBe(false);
        expect(isValidAuthToken(undefined)).toBe(false);
    });

    it('stores only a digest and replaces older tokens for the same purpose', async () => {
        mockedPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
        mockedPrisma.verificationToken.create.mockResolvedValue({});
        mockedPrisma.$executeRaw.mockResolvedValue(0);

        const token = await issueAuthToken('verify-email', 'Ada@Example.com', 3_600);

        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(mockedPrisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(mockedPrisma.verificationToken.deleteMany).toHaveBeenCalledWith({
            where: { identifier: 'verify-email:ada@example.com' }
        });
        expect(mockedPrisma.verificationToken.create).toHaveBeenCalledWith({
            data: {
                identifier: 'verify-email:ada@example.com',
                token: createAuthTokenDigest(token),
                expires: expect.any(Date),
            }
        });
        expect(createAuthTokenDigest(token)).not.toContain(token);
    });

    it('prunes all expired authentication-token identifiers', async () => {
        mockedPrisma.$executeRaw.mockResolvedValue(3);

        await expect(pruneExpiredAuthTokens(250)).resolves.toBe(3);

        expect(mockedPrisma.$executeRaw).toHaveBeenCalledTimes(1);
        const query = mockedPrisma.$executeRaw.mock.calls[0][0];
        expect(query.strings.join('')).toContain('LIMIT');
        expect(query.values).toContain(250);
    });

    it('rejects invalid token cleanup batch sizes', async () => {
        await expect(pruneExpiredAuthTokens(0)).rejects.toThrow(
            'Cleanup limit must be a positive integer.'
        );
        expect(mockedPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('checks token usability without expensive password work', async () => {
        const rawToken = 'c'.repeat(43);
        mockedPrisma.verificationToken.findUnique.mockResolvedValue({
            identifier: 'reset-password:ada@example.com',
            token: createAuthTokenDigest(rawToken),
            expires: new Date(Date.now() + 60_000),
        });

        await expect(hasUsableAuthToken('reset-password', rawToken)).resolves.toBe(true);
        expect(mockedPrisma.verificationToken.findUnique).toHaveBeenCalledWith({
            where: { token: createAuthTokenDigest(rawToken) },
            select: { identifier: true, expires: true },
        });
    });

    it('atomically consumes one unexpired token and returns its normalized email', async () => {
        const rawToken = 'a'.repeat(43);
        mockedPrisma.verificationToken.findUnique.mockResolvedValue({
            identifier: 'reset-password:ada@example.com',
            token: createAuthTokenDigest(rawToken),
            expires: new Date(Date.now() + 60_000),
        });
        mockedPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });

        await expect(consumeAuthToken('reset-password', rawToken)).resolves.toBe('ada@example.com');
        expect(mockedPrisma.verificationToken.deleteMany).toHaveBeenCalledWith({
            where: {
                identifier: 'reset-password:ada@example.com',
                token: createAuthTokenDigest(rawToken),
                expires: { gt: expect.any(Date) },
            }
        });
    });

    it('rejects expired, wrong-purpose, and already-consumed tokens', async () => {
        const rawToken = 'b'.repeat(43);
        mockedPrisma.verificationToken.findUnique.mockResolvedValueOnce({
            identifier: 'verify-email:ada@example.com',
            token: createAuthTokenDigest(rawToken),
            expires: new Date(Date.now() - 1),
        });
        await expect(consumeAuthToken('verify-email', rawToken)).resolves.toBeNull();

        mockedPrisma.verificationToken.findUnique.mockResolvedValueOnce({
            identifier: 'reset-password:ada@example.com',
            token: createAuthTokenDigest(rawToken),
            expires: new Date(Date.now() + 60_000),
        });
        await expect(consumeAuthToken('verify-email', rawToken)).resolves.toBeNull();

        mockedPrisma.verificationToken.findUnique.mockResolvedValueOnce({
            identifier: 'verify-email:ada@example.com',
            token: createAuthTokenDigest(rawToken),
            expires: new Date(Date.now() + 60_000),
        });
        mockedPrisma.verificationToken.deleteMany.mockResolvedValueOnce({ count: 0 });
        await expect(consumeAuthToken('verify-email', rawToken)).resolves.toBeNull();
    });
});
