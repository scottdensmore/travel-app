/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

describe('staff MFA database state', () => {
    const root = process.cwd();
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const migrationPath = path.join(
        root,
        'prisma/migrations/20260714020000_add_staff_mfa/migration.sql'
    );

    it('stores only encrypted TOTP material and replay state', () => {
        expect(schema).toContain('staffMfaSecretEncrypted String?');
        expect(schema).toContain('staffMfaEnrolledAt      DateTime?');
        expect(schema).toContain('staffMfaLastUsedStep    Int?');
        expect(schema).not.toMatch(/staffMfaSecret\s+String/);
    });

    it('ships a migration with consistent enrollment-state constraints', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const migration = fs.readFileSync(migrationPath, 'utf8');
        expect(migration).toContain('staffMfaSecretEncrypted');
        expect(migration).toContain('staffMfaEnrolledAt');
        expect(migration).toContain('staffMfaLastUsedStep');
        expect(migration).toContain('User_staff_mfa_state_check');
    });
});
