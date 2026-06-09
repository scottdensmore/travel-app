/** @jest-environment node */
import { POST } from '@/app/api/auth/register/route';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: { user: { findUnique: jest.fn(), create: jest.fn() } },
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-pw') }));

const mockedPrisma = prisma as unknown as {
    user: { findUnique: jest.Mock; create: jest.Mock };
};

// The handler only calls req.json(); a minimal stub is enough.
const makeReq = (body: unknown) => ({ json: async () => body }) as any;

describe('POST /api/auth/register', () => {
    beforeEach(() => jest.clearAllMocks());

    it('never returns the password hash on success', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedPrisma.user.create.mockResolvedValue({
            id: 'u1',
            name: 'Ada',
            email: 'ada@example.com',
            password: 'hashed-pw',
            role: 'USER',
        });

        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'password123' }));
        expect(res.status).toBe(201);

        const data = await res.json();
        expect(data.user).toBeDefined();
        expect(data.user.password).toBeUndefined();
        expect(data.user).toMatchObject({ id: 'u1', email: 'ada@example.com' });
    });

    it('rejects an invalid email', async () => {
        const res = await POST(makeReq({ name: 'Ada', email: 'not-an-email', password: 'password123' }));
        expect(res.status).toBe(400);
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a too-short password', async () => {
        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'short' }));
        expect(res.status).toBe(400);
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects missing fields', async () => {
        const res = await POST(makeReq({ email: 'ada@example.com' }));
        expect(res.status).toBe(400);
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate user', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'password123' }));
        expect(res.status).toBe(400);
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });
});
