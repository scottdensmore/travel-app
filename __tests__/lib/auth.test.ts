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

// Imported after mocks so the mocked deps are wired in.
import { authOptions } from '@/lib/auth';

const authorize = (authOptions.providers[0] as any).authorize as (
    credentials: Record<string, string> | undefined
) => Promise<any>;

const mockedPrisma = prisma as unknown as { user: { findUnique: jest.Mock } };
const mockedCompare = bcrypt.compare as unknown as jest.Mock;

describe('authOptions credential authorize', () => {
    beforeEach(() => jest.clearAllMocks());

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

    it('always runs a bcrypt comparison even when the user does not exist (timing safety)', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedCompare.mockResolvedValue(false);
        await authorize({ email: 'nobody@example.com', password: 'whatever12' }).catch(() => {});
        expect(mockedCompare).toHaveBeenCalledTimes(1);
    });

    it('does not return the password hash on a valid login', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({
            id: 'u1', email: 'a@b.com', name: 'Ada', image: null, password: 'real-hash', role: 'USER',
        });
        mockedCompare.mockResolvedValue(true);

        const result = await authorize({ email: 'a@b.com', password: 'correct-horse' });

        expect(result).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'USER' });
        expect(result.password).toBeUndefined();
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

    it('jwt callback copies id and role from user onto the token', async () => {
        const token = await jwt({
            token: {},
            user: { id: 'u1', role: 'ADMIN' },
        });
        expect(token).toMatchObject({ id: 'u1', role: 'ADMIN' });
    });

    it('jwt callback leaves the token unchanged when there is no user', async () => {
        const token = await jwt({ token: { id: 'existing', role: 'USER' } });
        expect(token).toMatchObject({ id: 'existing', role: 'USER' });
    });

    it('session callback exposes id and role on session.user', async () => {
        const result = await session({
            session: { user: { email: 'a@b.com' } },
            token: { id: 'u1', role: 'ADMIN' },
        });
        expect(result.user).toMatchObject({ id: 'u1', role: 'ADMIN', email: 'a@b.com' });
    });
});
