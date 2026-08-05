import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

const isDevelopment = process.env.NODE_ENV === 'development';

export type PrismaLogLevel = 'warn' | 'error';

export interface PrismaLogEvent {
    timestamp: Date;
    message: string;
    target: string;
}

export interface RedactedPrismaLogRecord {
    level: PrismaLogLevel;
    timestamp: Date;
    target: string;
    /** Postgres SQLSTATE, or a Prisma `P####` code. */
    code: string | null;
    relation: string | null;
    constraint: string | null;
    /** Column names, for the unique-constraint form that names no relation. */
    fields: string[] | null;
}

/**
 * Everything after one of these is row data, so no pattern below is allowed to
 * see it.
 *
 * A NOT NULL or foreign-key violation formats the *whole* message as the
 * failing row, and a row can contain the literal text `relation "..."` — so a
 * pattern run over the full message will happily extract a column value and
 * call it a schema name.
 *
 * This list is a mitigation, not a boundary: it names the places Postgres is
 * known to put row data. A class 22 error quotes the offending value in its
 * primary message, where none of these markers precede it — that case is #163,
 * and it is a forgery risk rather than a disclosure one.
 */
const ROW_DATA_MARKERS = [
    /Failing row contains/i,
    /\bDETAIL:/,
    /detail: Some\(/,
    /\bKey \(/,
];

function beforeRowData(message: string): string {
    let end = message.length;
    for (const marker of ROW_DATA_MARKERS) {
        const index = message.search(marker);
        if (index !== -1 && index < end) end = index;
    }
    return message.slice(0, end);
}

/**
 * Postgres quotes schema names, Prisma re-escapes them on the way through, and
 * the raw-query path spells the code differently again — hence the alternatives.
 */
const CODE = /\bcode:\s*["`]([0-9A-Za-z]{5})["`]/i;
const PRISMA_CODE = /\b(P\d{4})\b/;

/**
 * A quoted schema name, wherever Postgres puts one.
 *
 * These are deliberately not anchored to Postgres's sentence templates. That
 * was tried: it cost the `42P01` / `42P07` / `42704` schema-drift diagnostics —
 * the ones worth most when a deploy meets an unmigrated database — and bought
 * nothing, because a caller who can plant `relation "x"` in their own input can
 * equally plant `new row for relation "x" violates`. Lengthening the phrase
 * only lengthens the payload.
 *
 * What that leaves is a forgery risk rather than a disclosure one: someone able
 * to get a chosen string into a failing query can write chosen text into these
 * two fields. It cannot reach another customer's data, which is #142's concern,
 * and closing it properly means checking the extracted name against the schema
 * rather than against its shape (#163).
 */
const RELATION = /relation \\?"([A-Za-z0-9_]+)\\?"/;
const CONSTRAINT = /constraint \\?"([A-Za-z0-9_]+)\\?"/;
/** `Unique constraint failed on the fields: (`email`)` — no SQLSTATE at all. */
const UNIQUE_FIELDS = /Unique constraint failed on the fields?: \(([^)]*)\)/;
/**
 * Prisma 5 says `Foreign key constraint violated: `X (index)``; older wording
 * was `failed on the field:`. Neither string exists in the JS runtime — they
 * come from the Rust engine, so both are kept.
 */
const FOREIGN_KEY = /Foreign key constraint (?:violated|failed on the field):\s*`?([A-Za-z0-9_]+)/;

function firstMatch(pattern: RegExp, message: string): string | null {
    return pattern.exec(message)?.[1] ?? null;
}

/**
 * Keeps only what is shaped like a bare identifier.
 *
 * This is a filter on shape, not on provenance: it drops anything carrying `@`,
 * `.`, `-`, `/` or whitespace, which is what makes an email address — the #142
 * payload — unable to pass. An identifier-shaped secret such as a cuid or a hex
 * digest fits the shape, so this is not a boundary either; `beforeRowData` is
 * what keeps values out, and #163 covers the rest.
 */
function identifiers(captured: string | null): string[] | null {
    if (captured === null) return null;
    const names = captured
        .split(',')
        .map((name) => name.trim().replace(/[`"]/g, ''))
        .filter((name) => /^[A-Za-z0-9_]+$/.test(name));
    return names.length > 0 ? names : null;
}

/**
 * Builds the record that is safe to write for a Prisma warning or error.
 *
 * A Postgres error embeds the offending row in its `detail` — the observed case
 * was a customer's email address on stdout in production (#142) — so the record
 * is assembled from named fields rather than filtered down from the message.
 * Anything not on this list is dropped, including the message itself: an
 * unrecognised failure may carry anything, and a whitelist is the only form of
 * this that stays correct as Prisma's wording changes.
 *
 * The cost is real. An operator gets the code, the relation, the constraint and
 * the columns, which is enough to identify a failure but not to read the values
 * behind it. Reproducing with data is a development-environment job, where
 * `query` logging is still on and the data is seeded.
 *
 * Warnings go through the same treatment, which looks over-cautious given they
 * are engine and client messages rather than query results. They are not
 * exempt: Prisma interpolates an arbitrary upstream message into its retry
 * warning, and it puts connection identity into log text elsewhere — a failed
 * connection names the database user. There is no level that is safe by
 * default, so none is treated as one.
 */
export function redactPrismaLogEvent(
    level: PrismaLogLevel,
    event: PrismaLogEvent,
): RedactedPrismaLogRecord {
    const safe = beforeRowData(event.message);
    const fields = identifiers(firstMatch(UNIQUE_FIELDS, safe));

    return {
        level,
        timestamp: event.timestamp,
        target: event.target,
        // Prisma states the code in its own vocabulary for the two forms that
        // carry no SQLSTATE, so those are read from the wording it controls.
        code:
            firstMatch(CODE, safe)
            ?? firstMatch(PRISMA_CODE, safe)
            ?? (fields ? 'P2002' : null)
            ?? (FOREIGN_KEY.test(safe) ? 'P2003' : null),
        relation: firstMatch(RELATION, safe),
        constraint: firstMatch(CONSTRAINT, safe) ?? firstMatch(FOREIGN_KEY, safe),
        fields,
    };
}

/**
 * Prisma's `query` log writes each statement's bind parameters, which include
 * customer email addresses and token digests. Keep it for local development,
 * where the visibility is useful and the data is seeded, and keep it out of
 * every other environment.
 *
 * Warnings and errors are always reported, but never by Prisma itself outside
 * development: it is handed an event emitter so the payload passes through
 * `redactPrismaLogEvent` before anything is written.
 */
function createPrismaClient(): PrismaClient {
    if (isDevelopment) {
        const developmentLog: Prisma.LogLevel[] = ['query', 'warn', 'error'];
        return new PrismaClient({ log: developmentLog });
    }

    const client = new PrismaClient({
        log: [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
        ],
    });

    client.$on('warn', (event) => {
        console.warn(redactPrismaLogEvent('warn', event));
    });
    client.$on('error', (event) => {
        console.error(redactPrismaLogEvent('error', event));
    });

    return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
