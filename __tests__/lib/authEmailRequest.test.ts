/** @jest-environment node */
jest.mock('@/lib/authRateLimit', () => ({ consumeAuthRateLimit: jest.fn() }));
jest.mock('@/lib/afterResponse', () => ({
    scheduleAfterResponse: jest.fn((operation: () => Promise<void>) => { void operation(); })
}));

import { consumeAuthRateLimit } from '@/lib/authRateLimit';
import { handleAuthEmailRequest } from '@/lib/authEmailRequest';

const requestFor = (email: string, headers: Record<string, string> = {}) => new Request(
    'http://localhost/api/auth/request',
    {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ email }),
    }
);

describe('generic authentication email requests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.AUTH_TRUSTED_PROXY_HOPS;
        (consumeAuthRateLimit as jest.Mock).mockResolvedValue({
            allowed: true, retryAfterSeconds: 0
        });
    });

    it('normalizes email and always returns a generic accepted response', async () => {
        const operation = jest.fn().mockResolvedValue(undefined);

        const response = await handleAuthEmailRequest(
            requestFor(' ADA@Example.com '),
            'verify-request',
            operation
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
            message: 'If the account is eligible, an email will be sent shortly.'
        });
        expect(operation).toHaveBeenCalledWith('ada@example.com');
    });

    it('keeps the same response when delivery or lookup fails', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const operation = jest.fn().mockRejectedValue(new Error('SMTP recipient detail'));

        const response = await handleAuthEmailRequest(
            requestFor('ada@example.com'),
            'reset-request',
            operation
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
            message: 'If the account is eligible, an email will be sent shortly.'
        });
        expect(consoleError).toHaveBeenCalledWith('Unable to deliver requested authentication email.');
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('SMTP recipient detail');
        consoleError.mockRestore();
    });

    it('rate limits by normalized email before performing the operation', async () => {
        (consumeAuthRateLimit as jest.Mock).mockResolvedValue({
            allowed: false, retryAfterSeconds: 90
        });
        const operation = jest.fn();

        const response = await handleAuthEmailRequest(
            requestFor(' ADA@Example.com '),
            'reset-request',
            operation
        );

        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('90');
        expect(consumeAuthRateLimit).toHaveBeenCalledWith('reset-request-email', 'ada@example.com', {
            limit: 3,
            windowSeconds: 60 * 60,
        });
        expect(operation).not.toHaveBeenCalled();
    });

    it('rejects invalid email input without invoking the operation', async () => {
        const operation = jest.fn();
        const response = await handleAuthEmailRequest(
            requestFor('not-an-email'),
            'verify-request',
            operation
        );

        expect(response.status).toBe(400);
        expect(operation).not.toHaveBeenCalled();
    });
});
