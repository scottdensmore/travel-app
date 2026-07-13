/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: { $executeRaw: jest.fn() }
}));

import { createAuthRateLimitKey, pruneExpiredAuthRateLimits } from '@/lib/authRateLimit';
import { prisma } from '@/lib/prisma';

describe('authentication rate-limit keys', () => {
    beforeEach(() => jest.clearAllMocks());

    it('uses a stable keyed digest without retaining the email or IP address', () => {
        const first = createAuthRateLimitKey('login-email', 'Ada@Example.com', 'test-secret');
        const second = createAuthRateLimitKey('login-email', 'Ada@Example.com', 'test-secret');

        expect(first).toBe(second);
        expect(first).toMatch(/^login-email:[a-f0-9]{64}$/);
        expect(first).not.toContain('Ada@Example.com');
    });

    it('separates actions and identifiers', () => {
        expect(createAuthRateLimitKey('login-email', 'a@example.com', 'test-secret'))
            .not.toBe(createAuthRateLimitKey('register-email', 'a@example.com', 'test-secret'));
        expect(createAuthRateLimitKey('login-email', 'a@example.com', 'test-secret'))
            .not.toBe(createAuthRateLimitKey('login-email', 'b@example.com', 'test-secret'));
    });

    it('prunes expired rows in bounded batches', async () => {
        (prisma.$executeRaw as jest.Mock).mockResolvedValue(250);

        await expect(pruneExpiredAuthRateLimits(250)).resolves.toBe(250);
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid cleanup batch sizes', async () => {
        await expect(pruneExpiredAuthRateLimits(0)).rejects.toThrow('Cleanup limit must be a positive integer.');
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
});
