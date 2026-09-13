import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');
const HISTORICAL_CHECKSUM_FROZEN_EXCEPTION = '20260807120000_type_cabin_class';

export function stripSqlComments(sql: string): string {
    // Strip multi-line comments /* ... */
    const withoutMultiLine = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    // Strip single-line comments -- ...
    const withoutSingleLine = withoutMultiLine.replace(/--.*$/gm, '');
    return withoutSingleLine;
}

export function hasBareSetLockTimeout(sqlContent: string): boolean {
    const stripped = stripSqlComments(sqlContent);
    // Matches "SET lock_timeout" or "SET SESSION lock_timeout" (case-insensitive),
    // but not "SET LOCAL lock_timeout"
    const bareSetRegex = /\bSET\s+(?!LOCAL\b)(?:SESSION\s+)?lock_timeout\b/i;
    return bareSetRegex.test(stripped);
}

export function hasSetLocalLockTimeout(sqlContent: string): boolean {
    const stripped = stripSqlComments(sqlContent);
    const localSetRegex = /\bSET\s+LOCAL\s+lock_timeout\b/i;
    return localSetRegex.test(stripped);
}

export function setsLockTimeout(sqlContent: string): boolean {
    const stripped = stripSqlComments(sqlContent);
    return /\block_timeout\b/i.test(stripped);
}

export interface MigrationFile {
    migrationName: string;
    filePath: string;
    content: string;
}

export function loadAllMigrations(): MigrationFile[] {
    const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
    const migrations: MigrationFile[] = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const sqlPath = path.join(MIGRATIONS_DIR, entry.name, 'migration.sql');
            if (fs.existsSync(sqlPath)) {
                migrations.push({
                    migrationName: entry.name,
                    filePath: sqlPath,
                    content: fs.readFileSync(sqlPath, 'utf8'),
                });
            }
        }
    }

    return migrations.sort((a, b) => a.migrationName.localeCompare(b.migrationName));
}

describe('Migration lock_timeout invariant (Issue #185)', () => {
    const allMigrations = loadAllMigrations();

    it('reads all prisma/migrations/*/migration.sql files', () => {
        expect(allMigrations.length).toBeGreaterThan(0);
        // Verify migration files actually contain SQL
        for (const migration of allMigrations) {
            expect(migration.content.trim().length).toBeGreaterThan(0);
        }
    });

    it('finds bare SET lock_timeout exclusively in the documented historical exception 20260807120000_type_cabin_class', () => {
        const bareSetMigrations = allMigrations.filter(m => hasBareSetLockTimeout(m.content));
        const bareSetNames = bareSetMigrations.map(m => m.migrationName);

        // The historical migration cannot be edited in place because _prisma_migrations
        // tracks migration checksums and changing it breaks `migrate deploy` on existing environments.
        expect(bareSetNames).toEqual([HISTORICAL_CHECKSUM_FROZEN_EXCEPTION]);
    });

    it('asserts that every migration setting lock_timeout uses SET LOCAL lock_timeout (except the historical exception)', () => {
        const migrationsSettingTimeout = allMigrations.filter(m => setsLockTimeout(m.content));
        expect(migrationsSettingTimeout.length).toBeGreaterThan(1);

        for (const migration of migrationsSettingTimeout) {
            if (migration.migrationName === HISTORICAL_CHECKSUM_FROZEN_EXCEPTION) {
                continue;
            }

            const usesLocal = hasSetLocalLockTimeout(migration.content);
            const hasBare = hasBareSetLockTimeout(migration.content);

            expect({
                migration: migration.migrationName,
                usesLocal,
                hasBare,
            }).toEqual({
                migration: migration.migrationName,
                usesLocal: true,
                hasBare: false,
            });
        }
    });

    it('asserts that any subsequent/future migrations strictly use SET LOCAL lock_timeout', () => {
        const subsequentMigrations = allMigrations.filter(
            m => m.migrationName > HISTORICAL_CHECKSUM_FROZEN_EXCEPTION
        );

        expect(subsequentMigrations.length).toBeGreaterThan(0);

        const subsequentViolations = subsequentMigrations.filter(m => hasBareSetLockTimeout(m.content));
        expect(subsequentViolations).toEqual([]);

        // Verify that migrations setting lock_timeout after the exception all use SET LOCAL
        const subsequentSettingTimeout = subsequentMigrations.filter(m => setsLockTimeout(m.content));
        expect(subsequentSettingTimeout.length).toBeGreaterThan(0);
        for (const migration of subsequentSettingTimeout) {
            expect(hasSetLocalLockTimeout(migration.content)).toBe(true);
        }
    });

    it('detects and rejects hypothetical bare SET or SET SESSION lock_timeout in future migrations', () => {
        const invalidBareSetSql = `
            -- Some migration comment
            SET lock_timeout = '3s';
            ALTER TABLE "Test" ADD COLUMN "test" TEXT;
        `;
        expect(hasBareSetLockTimeout(invalidBareSetSql)).toBe(true);
        expect(hasSetLocalLockTimeout(invalidBareSetSql)).toBe(false);

        const invalidSessionSetSql = `
            SET SESSION lock_timeout = '5s';
        `;
        expect(hasBareSetLockTimeout(invalidSessionSetSql)).toBe(true);
        expect(hasSetLocalLockTimeout(invalidSessionSetSql)).toBe(false);

        const validLocalSetSql = `
            -- LOCAL, so it lasts only this transaction
            SET LOCAL lock_timeout = '3s';
            ALTER TABLE "Test" ADD COLUMN "test" TEXT;
        `;
        expect(hasBareSetLockTimeout(validLocalSetSql)).toBe(false);
        expect(hasSetLocalLockTimeout(validLocalSetSql)).toBe(true);
    });
});
