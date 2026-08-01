/** @jest-environment node */
const clientOptions = jest.fn();

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation((options: unknown) => {
        clientOptions(options);
        return {};
    }),
}));

type PrismaLogOptions = { log?: string[] };

/**
 * The client is a module-level singleton cached on globalThis, so both have to
 * be cleared to observe construction under a different environment.
 */
function loadClientWithNodeEnv(nodeEnv: string | undefined): PrismaLogOptions {
    const previous = process.env.NODE_ENV;

    jest.resetModules();
    clientOptions.mockClear();
    delete (globalThis as unknown as { prisma?: unknown }).prisma;

    if (nodeEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
        (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
    }

    try {
        jest.isolateModules(() => {
            require('@/lib/prisma');
        });
        return clientOptions.mock.calls[0][0] as PrismaLogOptions;
    } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
}

describe('prisma client logging', () => {
    afterAll(() => {
        delete (globalThis as unknown as { prisma?: unknown }).prisma;
    });

    it('logs queries during local development', () => {
        expect(loadClientWithNodeEnv('development').log).toContain('query');
    });

    it('never logs queries in production', () => {
        // Prisma's query log includes bind parameters, so this would write
        // customer email addresses and token digests to deployed stdout.
        expect(loadClientWithNodeEnv('production').log).not.toContain('query');
    });

    it('never logs queries when the environment is unset, as in seeds and scripts', () => {
        expect(loadClientWithNodeEnv(undefined).log).not.toContain('query');
    });

    it('keeps warnings and errors in every environment', () => {
        for (const environment of ['development', 'production', 'test', undefined]) {
            const { log } = loadClientWithNodeEnv(environment);
            expect(log).toEqual(expect.arrayContaining(['warn', 'error']));
        }
    });
});
