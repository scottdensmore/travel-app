/** @jest-environment node */

import { prisma } from '@/lib/prisma';

describe('flight schedule deletion audit schema', () => {
    it('retains prior terms history and stores an immutable standalone deletion receipt', async () => {
        const [shape] = await prisma.$queryRaw<Array<{
            deletionTable: string | null;
            termsScheduleRequired: boolean;
            termsForeignKeyCount: number;
        }>>`
            SELECT
                to_regclass('"FlightScheduleDeletion"')::text AS "deletionTable",
                (SELECT is_nullable = 'NO'
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'FlightScheduleTermsChange'
                   AND column_name = 'flightScheduleId') AS "termsScheduleRequired",
                (SELECT count(*)::int
                 FROM information_schema.table_constraints
                 WHERE constraint_schema = 'public'
                   AND table_name = 'FlightScheduleTermsChange'
                   AND constraint_name = 'FlightScheduleTermsChange_flightScheduleId_fkey') AS "termsForeignKeyCount"
        `;

        expect(shape).toEqual({
            deletionTable: '"FlightScheduleDeletion"',
            termsScheduleRequired: true,
            termsForeignKeyCount: 0,
        });
    });
});
