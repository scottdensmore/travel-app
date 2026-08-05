/** @jest-environment node */
const clientOptions = jest.fn();

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation((options: unknown) => {
        clientOptions(options);
        return { $on: jest.fn() };
    }),
}));

type PrismaLogEntry = string | { emit: string; level: string };
type PrismaLogOptions = { log?: PrismaLogEntry[] };

/**
 * Which levels are enabled, whether Prisma writes them itself (a bare string)
 * or hands them over as events for redaction (#142). These tests are about the
 * levels; `__tests__/security/prismaLogging.test.ts` owns the delivery.
 */
function enabledLevels(options: PrismaLogOptions): string[] {
    return (options.log ?? []).map((entry) =>
        typeof entry === 'string' ? entry : entry.level
    );
}

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
        expect(enabledLevels(loadClientWithNodeEnv('development'))).toContain('query');
    });

    it('never logs queries in production', () => {
        // Prisma's query log includes bind parameters, so this would write
        // customer email addresses and token digests to deployed stdout.
        expect(enabledLevels(loadClientWithNodeEnv('production'))).not.toContain('query');
    });

    it('never logs queries when the environment is unset, as in seeds and scripts', () => {
        expect(enabledLevels(loadClientWithNodeEnv(undefined))).not.toContain('query');
    });

    it('keeps warnings and errors in every environment', () => {
        for (const environment of ['development', 'production', 'test', undefined]) {
            const levels = enabledLevels(loadClientWithNodeEnv(environment));
            expect(levels).toEqual(expect.arrayContaining(['warn', 'error']));
        }
    });
});
