/** @jest-environment node */

import fs from 'fs';
import path from 'path';

describe('flight schedule provenance Prisma contract', () => {
    it('keeps the generated client relation aligned with the database contract', () => {
        const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
        const flight = schema.match(/model Flight \{([\s\S]*?)\n\}/)?.[1];
        const schedule = schema.match(/model FlightSchedule \{([\s\S]*?)\n\}/)?.[1];

        expect(flight).toContain('flightScheduleId Int?');
        expect(flight).toContain(
            'FlightSchedule? @relation(fields: [flightScheduleId], references: [id], onDelete: SetNull)',
        );
        expect(flight).toContain('@@index([flightScheduleId])');
        expect(schedule).toMatch(/flights\s+Flight\[\]/);
    });
});
