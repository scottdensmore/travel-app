/** @jest-environment node */
import { POST } from '@/app/api/auth/register/route';
import { prisma } from '@/lib/prisma';
import { consumeAuthRateLimit } from '@/lib/authRateLimit';
import { requestEmailVerification } from '@/lib/authAccountFlows';
import { scheduleAfterResponse } from '@/lib/afterResponse';

jest.mock('@/lib/prisma', () => ({
    prisma: { user: { findUnique: jest.fn(), create: jest.fn() } },
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-pw') }));
jest.mock('@/lib/authRateLimit', () => ({ consumeAuthRateLimit: jest.fn() }));
jest.mock('@/lib/authAccountFlows', () => ({ requestEmailVerification: jest.fn() }));
jest.mock('@/lib/afterResponse', () => ({
    scheduleAfterResponse: jest.fn((operation: () => Promise<void>) => { void operation(); })
}));

const mockedPrisma = prisma as unknown as {
    user: { findUnique: jest.Mock; create: jest.Mock };
};
const mockedConsumeRateLimit = consumeAuthRateLimit as jest.Mock;

const makeReq = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
});

describe('POST /api/auth/register', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.AUTH_TRUSTED_PROXY_HOPS;
        mockedConsumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
        (requestEmailVerification as jest.Mock).mockReset().mockResolvedValue(undefined);
        (scheduleAfterResponse as jest.Mock).mockClear();
    });

    it('does not create a global address bucket when proxy trust is not configured', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

        await POST(makeReq(
            { name: 'Ada', email: 'ada@example.com', password: 'password123' },
            { 'x-forwarded-for': '198.51.100.10' }
        ));

        expect(mockedConsumeRateLimit).not.toHaveBeenCalledWith(
            'register-address', expect.anything(), expect.anything()
        );
    });

    it('fails closed when a configured trusted ingress does not provide a complete chain', async () => {
        process.env.AUTH_TRUSTED_PROXY_HOPS = '2';

        const res = await POST(makeReq(
            { name: 'Ada', email: 'ada@example.com', password: 'password123' },
            { 'x-forwarded-for': '203.0.113.9' }
        ));

        expect(res.status).toBe(400);
        expect(mockedConsumeRateLimit).not.toHaveBeenCalled();
        expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('uses the right-side address supplied by the configured trusted ingress', async () => {
        process.env.AUTH_TRUSTED_PROXY_HOPS = '1';
        mockedPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

        await POST(makeReq(
            { name: 'Ada', email: 'ada@example.com', password: 'password123' },
            { 'x-forwarded-for': 'spoofed-by-client, 203.0.113.9' }
        ));

        expect(mockedConsumeRateLimit).toHaveBeenNthCalledWith(2, 'register-address', '203.0.113.9', {
            limit: 50,
            windowSeconds: 60 * 60,
        });
    });

    it('returns only a generic acceptance response on success', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedPrisma.user.create.mockResolvedValue({
            id: 'u1',
            name: 'Ada',
            email: 'ada@example.com',
            password: 'hashed-pw',
            role: 'USER',
        });

        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'password123' }));
        expect(res.status).toBe(202);

        const data = await res.json();
        expect(data.user).toBeUndefined();
        expect(data).toEqual({ message: 'If this address can be registered, the request has been accepted.' });
        expect(requestEmailVerification).toHaveBeenCalledWith('ada@example.com');
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

    it('uses the same response for an existing account to prevent enumeration', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'password123' }));
        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({
            message: 'If this address can be registered, the request has been accepted.'
        });
        expect(mockedPrisma.user.create).not.toHaveBeenCalled();
        expect(requestEmailVerification).toHaveBeenCalledWith('ada@example.com');
    });

    it('keeps the generic response when verification delivery fails', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockedPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
        (requestEmailVerification as jest.Mock).mockRejectedValue(new Error('SMTP detail'));

        const res = await POST(makeReq({
            name: 'Ada', email: 'ada@example.com', password: 'password123'
        }));

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({
            message: 'If this address can be registered, the request has been accepted.'
        });
        expect(requestEmailVerification).toHaveBeenCalledWith('ada@example.com');
        expect(consoleErrorSpy.mock.calls.flat().join(' ')).not.toContain('SMTP detail');
        consoleErrorSpy.mockRestore();
    });

    it('rate limits registration by normalized email and client address', async () => {
        process.env.AUTH_TRUSTED_PROXY_HOPS = '1';
        mockedConsumeRateLimit
            .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
            .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });

        const res = await POST(makeReq(
            { name: 'Ada', email: ' ADA@Example.COM ', password: 'password123' },
            { 'x-forwarded-for': '203.0.113.9' }
        ));

        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('120');
        expect(await res.json()).toEqual({
            error: {
                code: 'RATE_LIMITED',
                message: 'Too many account requests. Please try again later.',
                fields: {}
            }
        });
        expect(mockedConsumeRateLimit).toHaveBeenNthCalledWith(1, 'register-email', 'ada@example.com', {
            limit: 3,
            windowSeconds: 60 * 60,
        });
        expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('treats a concurrent normalized-email conflict as the generic accepted response', async () => {
        mockedPrisma.user.findUnique.mockResolvedValue(null);
        mockedPrisma.user.create.mockRejectedValue({ code: 'P2002' });

        const res = await POST(makeReq({ name: 'Ada', email: 'ada@example.com', password: 'password123' }));

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({
            message: 'If this address can be registered, the request has been accepted.'
        });
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
