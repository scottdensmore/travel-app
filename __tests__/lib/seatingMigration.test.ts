/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

describe('seating configuration migration', () => {
    it('backfills the legacy 3/3/4/20 cabin boundaries', () => {
        const sql = fs.readFileSync(
            path.join(
                process.cwd(),
                'prisma/migrations/20260703184208_add_seating_configurations/migration.sql'
            ),
            'utf8'
        );

        expect(sql).toContain('UPDATE "Flight"');
        expect(sql).toContain('UPDATE "FlightSchedule"');
        expect(sql).toContain('"firstClassRows" = 3');
        expect(sql).toContain('"businessRows" = 3');
        expect(sql).toContain('"premiumEconomyRows" = 4');
        expect(sql).toContain('"economyRows" = 20');
        expect(sql).toContain('"seatPattern" = \'ABC-DEF\'');
        expect(sql.indexOf('ALTER TABLE "FlightSchedule"')).toBeLessThan(
            sql.indexOf('UPDATE "FlightSchedule"')
        );
    });
});
