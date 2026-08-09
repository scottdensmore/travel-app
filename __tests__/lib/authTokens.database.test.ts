/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { consumeAuthToken, issueAuthToken } from '@/lib/authTokens';

describe('authentication tokens in PostgreSQL', () => {
    const email = `token-race-${Date.now()}@example.com`;

    afterAll(async () => {
        await prisma.verificationToken.deleteMany({
            where: { identifier: { endsWith: `:${email}` } }
        });
        await prisma.$disconnect();
    });

    it('allows exactly one concurrent consumer and rejects replay', async () => {
        const token = await issueAuthToken('verify-email', email, 60);

        const results = await Promise.all([
            consumeAuthToken('verify-email', token),
            consumeAuthToken('verify-email', token),
        ]);

        expect(results.filter(result => result === email)).toHaveLength(1);
        expect(results.filter(result => result === null)).toHaveLength(1);
        await expect(consumeAuthToken('verify-email', token)).resolves.toBeNull();
    });

    it('keeps the latest expiring duplicate when the uniqueness migration runs', async () => {
        const migrationPath = path.resolve(
            process.cwd(),
            'prisma/migrations/20260713051000_unique_auth_token_identifier/migration.sql'
        );
        const migration = fs.readFileSync(migrationPath, 'utf8')
            .replaceAll('"VerificationToken"', '"VerificationTokenMigrationProbe"')
            .replaceAll('"VerificationToken_identifier_key"', '"VerificationTokenMigrationProbe_identifier_key"')
            .replaceAll('"VerificationToken_expires_idx"', '"VerificationTokenMigrationProbe_expires_idx"');
        const statements = migration.split(';').map(statement => statement.trim()).filter(Boolean);

        await prisma.$transaction(async transaction => {
            await transaction.$executeRawUnsafe(
                'CREATE TEMP TABLE "VerificationTokenMigrationProbe" '
                + '("identifier" TEXT NOT NULL, "token" TEXT NOT NULL, "expires" TIMESTAMP(3) NOT NULL)'
                + ' ON COMMIT DROP'
            );
            await transaction.$executeRawUnsafe(
                `INSERT INTO "VerificationTokenMigrationProbe" ("identifier", "token", "expires") VALUES
                ('verify-email:ada@example.com', 'older', NOW() + INTERVAL '1 hour'),
                ('verify-email:ada@example.com', 'latest', NOW() + INTERVAL '2 hours'),
                ('reset-password:ada@example.com', 'only', NOW() + INTERVAL '3 hours')`
            );
            for (const statement of statements) {
                await transaction.$executeRawUnsafe(statement);
            }
            const rows = await transaction.$queryRawUnsafe<Array<{ identifier: string; token: string }>>(
                'SELECT "identifier", "token" FROM "VerificationTokenMigrationProbe" ORDER BY "identifier"'
            );

            expect(rows).toEqual([
                { identifier: 'reset-password:ada@example.com', token: 'only' },
                { identifier: 'verify-email:ada@example.com', token: 'latest' },
            ]);
            await transaction.$executeRawUnsafe('SAVEPOINT duplicate_probe');
            let duplicateError: unknown;
            try {
                await transaction.$executeRawUnsafe(
                    `INSERT INTO "VerificationTokenMigrationProbe" ("identifier", "token", "expires")
                     VALUES ('verify-email:ada@example.com', 'duplicate', NOW())`
                );
            } catch (error) {
                duplicateError = error;
            }
            await transaction.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_probe');
            expect(duplicateError).toMatchObject({ code: 'P2010' });
        });
    });
});
