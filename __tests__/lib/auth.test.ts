/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// Make CredentialsProvider a pass-through so we can call the raw authorize fn.
jest.mock('next-auth/providers/credentials', () => ({
    __esModule: true,
    default: (opts: any) => opts,
}));
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }));
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));
jest.mock('@/lib/authRateLimit', () => ({
    consumeAuthRateLimit: jest.fn(),
    clearAuthRateLimit: jest.fn(),
}));

// Imported after mocks so the mocked deps are wired in.
import { authOptions } from '@/lib/auth';
import { clearAuthRateLimit, consumeAuthRateLimit } from '@/lib/authRateLimit';

const authorize = (authOptions.providers[0] as any).authorize as (
    credentials: Record<string, string> | undefined,
    request?: { headers?: Record<string, string | string[] | undefined> }
) => Promise<any>;

const mockedPrisma = prisma as unknown as { user: { findUnique: jest.Mock } };
const mockedCompare = bcrypt.compare as unknown as jest.Mock;
const mockedConsumeRateLimit = consumeAuthRateLimit as jest.Mock;
const mockedClearRateLimit = clearAuthRateLimit as jest.Mock;

describe('authOptions credential authorize', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.AUTH_TRUSTED_PROXY_HOPS;
        mockedConsumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    });

    it('normalizes the email before rate limiting and account lookup', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedCompare.mockResolvedValue(false);

        await authorize({ email: '  Ada@Example.COM ', password: 'whatever12' }).catch(() => {});

        expect(mockedConsumeRateLimit).toHaveBeenCalledWith('login-email', 'ada@example.com', {
            limit: 5,
            windowSeconds: 15 * 60,
        });
        expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { email: 'ada@example.com' },
        });
    });

    it('does not let targeted failed-attempt counters lock out valid credentials', async () => {
        mockedConsumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'u1', email: 'ada@example.com', name: 'Ada', image: null,
            password: 'real-hash', role: 'USER', emailVerified: new Date(),
        });
        mockedCompare.mockResolvedValue(true);

        const result = await authorize({ email: 'ada@example.com', password: 'correct-horse' });

        expect(result).toMatchObject({ id: 'u1' });
        expect(mockedClearRateLimit).toHaveBeenCalledWith('login-email', 'ada@example.com');
    });

    it('blocks rotating-email spray from a throttled trusted source before password work', async () => {
        process.env.AUTH_TRUSTED_PROXY_HOPS = '1';
        mockedConsumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });

        const error = await authorize(
            { email: 'randomized@example.com', password: 'whatever12' },
            { headers: { 'x-forwarded-for': 'spoofed, 203.0.113.10' } }
        ).catch(e => e);

        expect(error.message).toBe('Invalid email or password');
        expect(mockedConsumeRateLimit).toHaveBeenCalledWith('login-source', '203.0.113.10', {
            limit: 20,
            windowSeconds: 15 * 60,
        });
        expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockedCompare).not.toHaveBeenCalled();
    });

    it('returns the same generic error for unknown user and wrong password (no enumeration)', async () => {
        // Unknown user
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedCompare.mockResolvedValue(false);
        const unknownErr = await authorize({ email: 'nobody@example.com', password: 'whatever12' }).catch((e) => e);

        // Known user, wrong password
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'u1', email: 'a@b.com', password: 'real-hash', role: 'USER',
        });
        mockedCompare.mockResolvedValue(false);
        const wrongPwErr = await authorize({ email: 'a@b.com', password: 'whatever12' }).catch((e) => e);

        expect(unknownErr).toBeInstanceOf(Error);
        expect(wrongPwErr).toBeInstanceOf(Error);
        // The core anti-enumeration property: identical messages.
        expect(unknownErr.message).toBe(wrongPwErr.message);
        // And not the old leaky messages.
        expect(unknownErr.message).not.toBe('User not found');
        expect(wrongPwErr.message).not.toBe('Invalid password');
    });

    it('does not authenticate an account until its email is verified', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'u1', email: 'a@b.com', password: 'real-hash', role: 'USER', emailVerified: null,
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const error = await authorize({ email: 'a@b.com', password: 'correct-horse' }).catch(e => e);

        expect(error.message).toBe('Invalid email or password');
        expect(clearAuthRateLimit).not.toHaveBeenCalled();
    });

    it('always runs a bcrypt comparison even when the user does not exist (timing safety)', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedCompare.mockResolvedValue(false);
        await authorize({ email: 'nobody@example.com', password: 'whatever12' }).catch(() => {});
        expect(mockedCompare).toHaveBeenCalledTimes(1);
    });

    it('does not return the password hash on a valid login', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'u1', email: 'a@b.com', name: 'Ada', image: null, password: 'real-hash', role: 'USER',
            emailVerified: new Date(),
        });
        mockedCompare.mockResolvedValue(true);

        const result = await authorize({ email: 'a@b.com', password: 'correct-horse' });

        expect(result).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'USER' });
        expect(result.password).toBeUndefined();
        expect(mockedClearRateLimit).toHaveBeenCalledWith('login-email', 'a@b.com');
    });

    it('throws error when email or password is missing', async () => {
        const err1 = await authorize(undefined).catch((e) => e);
        const err2 = await authorize({ email: 'a@b.com' } as any).catch((e) => e);
        const err3 = await authorize({ password: 'pw' } as any).catch((e) => e);

        expect(err1.message).toBe('Invalid email or password');
        expect(err2.message).toBe('Invalid email or password');
        expect(err3.message).toBe('Invalid email or password');
    });
});


describe('authOptions jwt/session callbacks', () => {
    const jwt = (authOptions.callbacks!.jwt as any);
    const session = (authOptions.callbacks!.session as any);

    beforeEach(() => jest.clearAllMocks());

    it('jwt callback copies id, role, and auth version from user onto the token', async () => {
        const token = await jwt({
            token: {},
            user: { id: 'u1', role: 'ADMIN', authVersion: 2 },
        });
        expect(token).toMatchObject({ id: 'u1', role: 'ADMIN', authVersion: 2 });
    });

    it('jwt callback refreshes account state and invalidates older auth versions', async () => {
        mockedPrisma.user.findUnique.mockResolvedValueOnce({
            role: 'USER', authVersion: 1, emailVerified: new Date()
        });
        const current = await jwt({
            token: { id: 'existing', role: 'ADMIN', authVersion: 1 }
        });
        expect(current).toMatchObject({ role: 'USER', invalidated: false });

        mockedPrisma.user.findUnique.mockResolvedValueOnce({
            role: 'USER', authVersion: 2, emailVerified: new Date()
        });
        const stale = await jwt({
            token: { id: 'existing', role: 'USER', authVersion: 1 }
        });
        expect(stale).toMatchObject({ invalidated: true });
    });

    it('session callback exposes id and role on session.user', async () => {
        const result = await session({
            session: { user: { email: 'a@b.com' } },
            token: { id: 'u1', role: 'ADMIN' },
        });
        expect(result.user).toMatchObject({ id: 'u1', role: 'ADMIN', email: 'a@b.com' });
    });

    it('session callback returns no session for an invalidated token', async () => {
        const result = await session({
            session: { user: { email: 'a@b.com' } },
            token: { id: 'u1', role: 'USER', invalidated: true },
        });
        expect(result).toBeNull();
    });
});
