jest.mock('@/lib/authTokens', () => ({ pruneExpiredAuthTokens: jest.fn() }));

import { register } from '@/instrumentation';
import { pruneExpiredAuthTokens } from '@/lib/authTokens';

const originalEnvironment = process.env;

describe('server instrumentation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnvironment,
            NEXT_RUNTIME: 'nodejs',
            DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/travel_app',
            NEXTAUTH_URL: 'http://localhost:3000',
            NEXTAUTH_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
            AUTH_EMAIL_FROM: 'Mona Airways <no-reply@localhost>',
            AUTH_EMAIL_PROVIDER: 'mailpit',
            AUTH_EMAIL_API_URL: 'http://localhost:8025/api/v1/send',
        };
    });

    afterAll(() => {
        if (globalThis.authTokenPruneTimer) {
            clearInterval(globalThis.authTokenPruneTimer);
            globalThis.authTokenPruneTimer = undefined;
        }
        process.env = originalEnvironment;
    });

    it('validates the environment and prunes expired auth tokens when the Node.js server starts', async () => {
        (pruneExpiredAuthTokens as jest.Mock).mockResolvedValue(0);

        await expect(register()).resolves.toBeUndefined();
        expect(pruneExpiredAuthTokens).toHaveBeenCalled();
    });

    it('fails startup when a required setting is absent', async () => {
        delete process.env.NEXTAUTH_SECRET;

        await expect(register()).rejects.toThrow(
            'Missing required environment variable: NEXTAUTH_SECRET'
        );
    });

    it('does not run server validation in the edge runtime', async () => {
        process.env.NEXT_RUNTIME = 'edge';
        delete process.env.NEXTAUTH_SECRET;

        await expect(register()).resolves.toBeUndefined();
        expect(pruneExpiredAuthTokens).not.toHaveBeenCalled();
    });
});
