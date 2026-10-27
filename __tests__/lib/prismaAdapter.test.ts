/** @jest-environment node */
const poolOptions = jest.fn();
const connectPool = jest.fn();

jest.mock('@prisma/adapter-pg', () => ({
    PrismaPg: class {
        constructor(options: unknown) { poolOptions(options); }
        connect() { return connectPool(); }
    },
}));

import { createPrismaAdapter } from '@/lib/prismaAdapter';

describe('Prisma PostgreSQL adapter configuration', () => {
    const originalUrl = process.env.DATABASE_URL;

    afterEach(() => {
        if (originalUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalUrl;
        jest.clearAllMocks();
    });

    it('passes the configured URL unchanged without weakening TLS validation', async () => {
        process.env.DATABASE_URL = 'postgresql://ci:ci@localhost:5432/disposable?sslmode=verify-full';
        const adapter = createPrismaAdapter();
        expect(poolOptions).toHaveBeenCalledWith({
            connectionString: process.env.DATABASE_URL,
            connectionTimeoutMillis: 5_000,
            idleTimeoutMillis: 300_000,
            allowExitOnIdle: true,
        });
        connectPool.mockResolvedValueOnce({});
        await adapter.connect();
        expect(connectPool).toHaveBeenCalledTimes(1);
    });

    it('allows build-time construction but rejects a connection without DATABASE_URL', async () => {
        delete process.env.DATABASE_URL;
        const adapter = createPrismaAdapter();
        await expect(adapter.connect()).rejects.toThrow('DATABASE_URL must be configured');
        expect(connectPool).not.toHaveBeenCalled();
    });

    it('also refuses a blank URL rather than connecting to an ambient user database', async () => {
        process.env.DATABASE_URL = '  ';
        await expect(createPrismaAdapter().connect()).rejects.toThrow('DATABASE_URL must be configured');
        expect(connectPool).not.toHaveBeenCalled();
    });

    it('creates separate adapter instances for independent clients', () => {
        expect(createPrismaAdapter()).not.toBe(createPrismaAdapter());
    });
});
