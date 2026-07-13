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

const makeReq = (body: unknown) => new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
});

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
        expect(await res.json()).toMatchObject({
            error: {
                code: 'VALIDATION_ERROR',
                fields: { email: ['Enter a valid email address.'] }
            }
        });
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('normalizes names and email addresses before persistence', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedPrisma.user.create.mockResolvedValue({
            id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'USER'
        });

        await POST(makeReq({
            name: '  Ada  ', email: ' ADA@Example.COM ', password: 'password123'
        }));

        expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { email: 'ada@example.com' }
        });
        expect(mockedPrisma.user.create).toHaveBeenCalledWith({
            data: { name: 'Ada', email: 'ada@example.com', password: 'hashed-pw' }
        });
    });

    it('rejects oversized registration requests with a structured error', async () => {
        const res = await POST(makeReq({
            name: 'A'.repeat(20_000), email: 'ada@example.com', password: 'password123'
        }));

        expect(res.status).toBe(413);
        expect(await res.json()).toMatchObject({
            error: { code: 'VALIDATION_ERROR', message: 'Request is too large.' }
        });
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON with a structured customer-safe error', async () => {
        const request = new Request('http://localhost/api/auth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{not-json'
        });

        const res = await POST(request);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            error: {
                code: 'VALIDATION_ERROR',
                fields: { _root: ['Request body must be valid JSON.'] }
            }
        });
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
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: 'ACCOUNT_EXISTS' } });
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it('returns 500 when an internal database error occurs', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockedPrisma.user.findUnique.mockRejectedValue(new Error('DB failure'));

        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'password123' }));
        expect(res.status).toBe(500);
        
        const data = await res.json();
        expect(data.error).toMatchObject({
            code: 'INTERNAL_ERROR',
            message: 'Unable to create your account right now.'
        });
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });
});
