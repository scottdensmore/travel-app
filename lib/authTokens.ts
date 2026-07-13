import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type AuthTokenPurpose = 'verify-email' | 'reset-password';

export function createAuthTokenDigest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

async function pruneExpiredAuthTokenBatch(
    client: Prisma.TransactionClient | typeof prisma,
    limit: number
): Promise<number> {
    return client.$executeRaw(Prisma.sql`
        WITH expired AS (
            SELECT "token"
            FROM "VerificationToken"
            WHERE "expires" <= CURRENT_TIMESTAMP
            ORDER BY "expires" ASC
            LIMIT ${limit}
        )
        DELETE FROM "VerificationToken"
        WHERE "token" IN (SELECT "token" FROM expired)
    `);
}

export async function pruneExpiredAuthTokens(limit = 250): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('Cleanup limit must be a positive integer.');
    }
    return pruneExpiredAuthTokenBatch(prisma, limit);
}

export async function hasUsableAuthToken(
    purpose: AuthTokenPurpose,
    rawToken: string
): Promise<boolean> {
    const record = await prisma.verificationToken.findUnique({
        where: { token: createAuthTokenDigest(rawToken) },
        select: { identifier: true, expires: true },
    });
    return Boolean(
        record
        && record.identifier.startsWith(`${purpose}:`)
        && record.expires > new Date()
    );
}

export async function issueAuthToken(
    purpose: AuthTokenPurpose,
    emailAddress: string,
    lifetimeSeconds: number
): Promise<string> {
    if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1) {
        throw new Error('Token lifetime must be a positive integer.');
    }

    const email = emailAddress.trim().toLowerCase();
    const identifier = `${purpose}:${email}`;
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + lifetimeSeconds * 1_000);

    await prisma.$transaction(async transaction => {
        await pruneExpiredAuthTokenBatch(transaction, 100);
        await transaction.verificationToken.deleteMany({ where: { identifier } });
        await transaction.verificationToken.create({
            data: { identifier, token: createAuthTokenDigest(token), expires }
        });
    });

    return token;
}

export function consumeAuthToken(
    purpose: AuthTokenPurpose,
    rawToken: string
): Promise<string | null>;
export function consumeAuthToken<T>(
    purpose: AuthTokenPurpose,
    rawToken: string,
    operation: (transaction: Prisma.TransactionClient, email: string) => Promise<T>
): Promise<T | null>;
export async function consumeAuthToken<T>(
    purpose: AuthTokenPurpose,
    rawToken: string,
    operation?: (transaction: Prisma.TransactionClient, email: string) => Promise<T>
): Promise<string | T | null> {
    const token = createAuthTokenDigest(rawToken);

    return prisma.$transaction(async transaction => {
        const record = await transaction.verificationToken.findUnique({ where: { token } });
        if (!record) return null;

        const prefix = `${purpose}:`;
        const now = new Date();
        if (!record.identifier.startsWith(prefix) || record.expires <= now) {
            if (record.expires <= now) {
                await transaction.verificationToken.deleteMany({ where: { token } });
            }
            return null;
        }

        const deleted = await transaction.verificationToken.deleteMany({
            where: {
                identifier: record.identifier,
                token,
                expires: { gt: now },
            }
        });
        if (deleted.count !== 1) return null;

        const email = record.identifier.slice(prefix.length);
        return operation ? operation(transaction, email) : email;
    });
}
