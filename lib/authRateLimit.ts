import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface AuthRateLimitOptions {
    limit: number;
    windowSeconds: number;
}

export interface AuthRateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

export function createAuthRateLimitKey(action: string, identifier: string, secret: string): string {
    const digest = createHmac('sha256', secret).update(`${action}\0${identifier}`).digest('hex');
    return `${action}:${digest}`;
}

export async function pruneExpiredAuthRateLimits(limit = 250): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('Cleanup limit must be a positive integer.');
    }
    return prisma.$executeRaw(Prisma.sql`
        WITH expired AS (
            SELECT "key"
            FROM "AuthRateLimit"
            WHERE "expiresAt" <= CURRENT_TIMESTAMP
            ORDER BY "expiresAt" ASC
            LIMIT ${limit}
        )
        DELETE FROM "AuthRateLimit"
        WHERE "key" IN (SELECT "key" FROM expired)
    `);
}

function getRateLimitSecret(): string {
    const secret = process.env.NEXTAUTH_SECRET?.trim();
    if (!secret) throw new Error('Authentication rate limiting is not configured.');
    return secret;
}

export async function consumeAuthRateLimit(
    action: string,
    identifier: string,
    options: AuthRateLimitOptions
): Promise<AuthRateLimitResult> {
    await pruneExpiredAuthRateLimits();
    const key = createAuthRateLimitKey(action, identifier, getRateLimitSecret());
    const rows = await prisma.$queryRaw<Array<{ attempts: number; expiresAt: Date }>>(Prisma.sql`
        INSERT INTO "AuthRateLimit" ("key", "attempts", "windowStart", "expiresAt")
        VALUES (${key}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (${options.windowSeconds} * INTERVAL '1 second'))
        ON CONFLICT ("key") DO UPDATE SET
            "attempts" = CASE
                WHEN "AuthRateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN 1
                ELSE "AuthRateLimit"."attempts" + 1
            END,
            "windowStart" = CASE
                WHEN "AuthRateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
                ELSE "AuthRateLimit"."windowStart"
            END,
            "expiresAt" = CASE
                WHEN "AuthRateLimit"."expiresAt" <= CURRENT_TIMESTAMP
                    THEN CURRENT_TIMESTAMP + (${options.windowSeconds} * INTERVAL '1 second')
                ELSE "AuthRateLimit"."expiresAt"
            END
        RETURNING "attempts", "expiresAt"
    `);
    const row = rows[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));
    return { allowed: row.attempts <= options.limit, retryAfterSeconds };
}

export async function clearAuthRateLimit(action: string, identifier: string): Promise<void> {
    const key = createAuthRateLimitKey(action, identifier, getRateLimitSecret());
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "key" = ${key}`);
}
