/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

describe('passenger data storage schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

    it('does not define plaintext date-of-birth or passport columns', () => {
        const passengerModel = schema.match(/model Passenger \{([\s\S]*?)\n\}/)?.[1] ?? '';

        expect(passengerModel).toContain('dateOfBirthEncrypted');
        expect(passengerModel).toContain('passportNumberEncrypted');
        expect(passengerModel).not.toMatch(/^\s*dateOfBirth\s+/m);
        expect(passengerModel).not.toMatch(/^\s*passportNumber\s+/m);
    });

    it('tracks expiry and deletion of sensitive passenger data', () => {
        const passengerModel = schema.match(/model Passenger \{([\s\S]*?)\n\}/)?.[1] ?? '';

        expect(passengerModel).toContain('sensitiveDataExpiresAt');
        expect(passengerModel).toContain('sensitiveDataDeletedAt');
    });

    it('purges legacy plaintext columns in the migration', () => {
        const migration = fs.readFileSync(path.join(
            process.cwd(),
            'prisma/migrations/20260714010000_protect_passenger_data/migration.sql',
        ), 'utf8');

        expect(migration).toContain('DROP COLUMN "dateOfBirth"');
        expect(migration).toContain('DROP COLUMN "passportNumber"');
        expect(migration).toContain('SET "sensitiveDataDeletedAt" = CURRENT_TIMESTAMP');
        const constraintMigration = fs.readFileSync(path.join(
            process.cwd(),
            'prisma/migrations/20260714011000_enforce_passenger_data_state/migration.sql',
        ), 'utf8');
        expect(constraintMigration).toContain('Passenger_sensitive_data_state_check');
    });
});
