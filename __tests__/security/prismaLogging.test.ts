/** @jest-environment node */

/**
 * Prisma's `error` log level carries customer data, because a Postgres error
 * embeds the row that caused it. The level is enabled outside development, so
 * an email address reaches stdout in production (#142).
 *
 * These pin the two halves of the fix: the client emits warnings and errors as
 * events rather than writing them itself, and what the handler writes instead
 * is a whitelist that cannot carry a row.
 */

/**
 * Observed in this repository's own e2e output — the message that motivated the
 * issue, with the row payload intact.
 */
const LEAKING_ERROR_MESSAGE =
    'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(' +
    'PostgresError { code: "23514", message: "new row for relation \\"User\\" ' +
    'violates check constraint \\"User_email_canonical_check\\"", severity: "ERROR", ' +
    'detail: Some("Failing row contains (cmscbchtn0006sizjhse9nkks, Mixed Case, ' +
    'Mixed-1785706161200-9a21e78b2e76b@Example.com, null, null, not-used, USER, 0, ' +
    'null, null, null)"), column: None, hint: None }), transient: false })';

describe('prisma log redaction', () => {
    const { redactPrismaLogEvent } = require('@/lib/prisma') as typeof import('@/lib/prisma');

    const redacted = () => redactPrismaLogEvent('error', {
        timestamp: new Date('2026-08-05T10:00:00Z'),
        message: LEAKING_ERROR_MESSAGE,
        target: 'prisma.client',
    });

    it('keeps no part of the row that caused the error', () => {
        const serialized = JSON.stringify(redacted());

        expect(serialized).not.toContain('Mixed-1785706161200-9a21e78b2e76b@Example.com');
        expect(serialized).not.toContain('Failing row contains');
        expect(serialized).not.toContain('cmscbchtn0006sizjhse9nkks');
        // Nothing of the original message survives verbatim: the record is
        // built from named fields, not filtered down from the text.
        expect(serialized).not.toContain('detail');
    });

    it('keeps the schema names an operator needs to act on it', () => {
        expect(redacted()).toMatchObject({
            level: 'error',
            target: 'prisma.client',
            code: '23514',
            relation: 'User',
            constraint: 'User_email_canonical_check',
        });
    });

    it('refuses to read schema names out of the failing row itself', () => {
        // A NOT NULL or foreign-key violation formats the whole message as the
        // row, and a row can contain the literal words a schema pattern looks
        // for. Captured from a live client, with the values crafted to be
        // exactly what the patterns want.
        const record = redactPrismaLogEvent('error', {
            timestamp: new Date('2026-08-05T10:00:00Z'),
            message:
                '\nInvalid `prisma.$executeRawUnsafe()` invocation:\n\n\n' +
                'Raw query failed. Code: `23502`. Message: `Failing row contains ' +
                '(leak-1, u, relation \\"LEAKED_USER_SECRET\\" constraint ' +
                '\\"LEAKED_TOKEN_9f3a\\", m, null, f)`',
            target: '$executeRawUnsafe',
        });

        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain('LEAKED_USER_SECRET');
        expect(serialized).not.toContain('LEAKED_TOKEN_9f3a');
        expect(serialized).not.toContain('leak-1');
        expect(record.relation).toBeNull();
        expect(record.constraint).toBeNull();
        // The code sits before the row, so it survives the cut.
        expect(record.code).toBe('23502');
    });

    it('reads the code the raw-query path spells differently', () => {
        // `Raw query failed. Code: \`23514\`.` — capital C, backticks. The repo
        // runs raw SQL in the auth rate-limit, token and flight-lock paths.
        const record = redactPrismaLogEvent('error', {
            timestamp: new Date('2026-08-05T10:00:00Z'),
            message: 'Raw query failed. Code: `23514`. Message: `some failure`',
            target: '$queryRaw',
        });

        expect(record.code).toBe('23514');
    });

    it.each([
        // Captured from a live Prisma 5.22 client against this schema. These
        // are the schema-drift signals worth most in production — a deploy that
        // met an unmigrated database — and an earlier attempt at hardening
        // silently dropped all three.
        [
            'Raw query failed. Code: `42P01`. Message: `ERROR: relation "NoSuchTable" does not exist`',
            { code: '42P01', relation: 'NoSuchTable' },
        ],
        [
            'Raw query failed. Code: `42P07`. Message: `ERROR: relation "User" already exists`',
            { code: '42P07', relation: 'User' },
        ],
        [
            'Raw query failed. Code: `42704`. Message: `ERROR: constraint "NoSuchConstraint" of relation "User" does not exist`',
            { code: '42704', relation: 'User', constraint: 'NoSuchConstraint' },
        ],
    ])('reports the schema object behind %#', (message, expected) => {
        expect(redactPrismaLogEvent('error', {
            timestamp: new Date('2026-08-05T10:00:00Z'),
            message: message as string,
            target: '$queryRaw',
        })).toMatchObject(expected as object);
    });

    it('reads the foreign-key wording this Prisma version actually emits', () => {
        // Prisma 5 says "violated:", not "failed on the field:". The regex was
        // written for wording no live client produces, so every foreign-key
        // failure redacted to an entirely content-free record.
        const record = redactPrismaLogEvent('error', {
            timestamp: new Date('2026-08-05T10:00:00Z'),
            message: 'Foreign key constraint violated: `Review_userId_fkey (index)`',
            target: 'review.create',
        });

        expect(record).toMatchObject({ code: 'P2003', constraint: 'Review_userId_fkey' });
    });

    it('names the columns of a unique-constraint failure, which carries no code', () => {
        // Prisma's own wording, with no SQLSTATE, relation or constraint in it
        // — the commonest error in the auth paths, and previously redacted to
        // an entirely content-free record.
        const record = redactPrismaLogEvent('error', {
            timestamp: new Date('2026-08-05T10:00:00Z'),
            message: 'Unique constraint failed on the fields: (`email`)',
            target: 'user.create',
        });

        expect(record).toMatchObject({ code: 'P2002', fields: ['email'] });
    });

    it('says nothing rather than guessing when the message is unfamiliar', () => {
        // A whitelist fails closed: an unrecognised message may carry anything,
        // so none of it is written.
        const record = redactPrismaLogEvent('error', {
            timestamp: new Date('2026-08-05T10:00:00Z'),
            message: 'Some unstructured failure mentioning ada@example.com',
            target: 'prisma.engine',
        });

        expect(JSON.stringify(record)).not.toContain('ada@example.com');
        expect(record).toMatchObject({
            level: 'error',
            target: 'prisma.engine',
            code: null,
            relation: null,
            constraint: null,
            fields: null,
        });
    });
});

describe('prisma client logging configuration', () => {
    const loadPrismaModule = (nodeEnv: string) => {
        const constructorCalls: unknown[] = [];
        const handlers = new Map<string, (event: unknown) => void>();

        jest.resetModules();
        jest.doMock('@prisma/client', () => ({
            PrismaClient: class {
                constructor(options: unknown) {
                    constructorCalls.push(options);
                }
                $on(event: string, handler: (payload: unknown) => void) {
                    handlers.set(event, handler);
                }
            },
        }));

        // The module reuses a client parked on globalThis outside production,
        // so a stale one from an earlier require would skip construction here.
        delete (globalThis as { prisma?: unknown }).prisma;

        const previous = process.env.NODE_ENV;
        // NODE_ENV is read at module load, so it has to be in place first.
        Object.defineProperty(process.env, 'NODE_ENV', { value: nodeEnv, configurable: true });
        try {
            jest.isolateModules(() => {
                require('@/lib/prisma');
            });
        } finally {
            Object.defineProperty(process.env, 'NODE_ENV', { value: previous, configurable: true });
        }

        return { options: constructorCalls[0], handlers };
    };

    afterEach(() => {
        jest.dontMock('@prisma/client');
        jest.resetModules();
    });

    it('never lets Prisma write a warning or error itself outside development', () => {
        const { options, handlers } = loadPrismaModule('production');
        const levels = (options as { log: Array<{ emit?: string; level: string }> }).log;

        // A bare string entry, or emit: 'stdout', is Prisma writing the raw
        // message — which is the defect. Which levels are enabled is
        // `__tests__/lib/prisma.test.ts`; this is about who writes them.
        expect(levels.length).toBeGreaterThan(0);
        for (const entry of levels) {
            expect(typeof entry).toBe('object');
            expect(entry.emit).toBe('event');
        }
        // Emitting without subscribing would lose the diagnostics entirely.
        expect([...handlers.keys()].sort()).toEqual(['error', 'warn']);
    });

    it('writes only the redacted record when an error is emitted', () => {
        const { handlers } = loadPrismaModule('production');
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            handlers.get('error')!({
                timestamp: new Date('2026-08-05T10:00:00Z'),
                message: LEAKING_ERROR_MESSAGE,
                target: 'prisma.client',
            });

            expect(consoleError).toHaveBeenCalledTimes(1);
            const written = JSON.stringify(consoleError.mock.calls[0]);
            expect(written).not.toContain('Mixed-1785706161200-9a21e78b2e76b@Example.com');
            expect(written).not.toContain('Failing row contains');
            expect(written).toContain('User_email_canonical_check');
        } finally {
            consoleError.mockRestore();
        }
    });

    it('redacts a warning too, since no level is safe by default', () => {
        // The warn handler is otherwise unexercised: a local library engine
        // emits warnings rarely enough that no live one was ever observed.
        const { handlers } = loadPrismaModule('production');
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            handlers.get('warn')!({
                timestamp: new Date('2026-08-05T10:00:00Z'),
                message: 'Attempt 2/3 failed for query: ada@example.com is not valid',
                target: 'prisma.client',
            });

            expect(consoleWarn).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(consoleWarn.mock.calls[0])).not.toContain('ada@example.com');
        } finally {
            consoleWarn.mockRestore();
        }
    });

    it('leaves development writing to stdout, where the data is seeded', () => {
        const { handlers } = loadPrismaModule('development');

        // No redaction there, deliberately: the visibility is the point and
        // there is no customer data to protect.
        expect(handlers.size).toBe(0);
    });
});
