import { register } from '@/instrumentation';

const originalEnvironment = process.env;

describe('server instrumentation', () => {
    beforeEach(() => {
        process.env = {
            ...originalEnvironment,
            NEXT_RUNTIME: 'nodejs',
            DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/travel_app',
            NEXTAUTH_URL: 'http://localhost:3000',
            NEXTAUTH_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
        };
    });

    afterAll(() => {
        process.env = originalEnvironment;
    });

    it('validates the environment when the Node.js server starts', () => {
        expect(() => register()).not.toThrow();
    });

    it('fails startup when a required setting is absent', () => {
        delete process.env.NEXTAUTH_SECRET;

        expect(() => register()).toThrow(
            'Missing required environment variable: NEXTAUTH_SECRET'
        );
    });

    it('does not run server validation in the edge runtime', () => {
        process.env.NEXT_RUNTIME = 'edge';
        delete process.env.NEXTAUTH_SECRET;

        expect(() => register()).not.toThrow();
    });
});
