/** @jest-environment node */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

describe('flight schedule provenance integrity', () => {
    const createdFlightIds: number[] = [];
    const createdScheduleIds: number[] = [];

    afterEach(async () => {
        await prisma.flight.deleteMany({ where: { id: { in: createdFlightIds } } });
        await prisma.flightSchedule.deleteMany({ where: { id: { in: createdScheduleIds } } });
        createdFlightIds.length = 0;
        createdScheduleIds.length = 0;
    });

    const createSchedule = async () => {
        const suffix = randomUUID().slice(0, 6).toUpperCase();
        const schedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: `P${suffix}`,
                airline: 'Provenance Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1],
                priceCents: 35_000,
            },
        });
        createdScheduleIds.push(schedule.id);
        return schedule;
    };

    const flightData = (flightNumber: string, flightScheduleId: number) => ({
        flightNumber,
        airline: 'Provenance Airways',
        fromAirportCode: 'SEA',
        toAirportCode: 'DTW',
        departureDate: new Date('2098-01-05T16:00:00Z'),
        durationMinutes: 245,
        priceCents: 35_000,
        status: 'ON_TIME' as const,
        flightScheduleId,
    });

    it('refuses provenance that names no schedule', async () => {
        await expect(prisma.flight.create({
            data: flightData(`X${randomUUID().slice(0, 6).toUpperCase()}`, 2_000_000_000),
        })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('preserves an occurrence but clears its provenance when its schedule is deleted', async () => {
        const schedule = await createSchedule();
        const flight = await prisma.flight.create({
            data: flightData(schedule.flightNumber, schedule.id),
        });
        createdFlightIds.push(flight.id);

        await prisma.flightSchedule.delete({ where: { id: schedule.id } });
        createdScheduleIds.length = 0;

        await expect(prisma.flight.findUnique({ where: { id: flight.id } }))
            .resolves.toMatchObject({ id: flight.id, flightScheduleId: null });
    });

    it('backfills only an occurrence with one exact timetable match', async () => {
        const migration = fs.readFileSync(path.join(
            process.cwd(),
            'prisma/migrations/20260817070000_link_flights_to_schedules/migration.sql',
        ), 'utf8');
        const backfill = migration.match(
            /WITH candidates AS \([\s\S]*?WHERE f\."id" = unambiguous\."flightId";/,
        )?.[0];

        expect(backfill).toBeDefined();

        await prisma.$transaction(async tx => {
            await tx.$executeRawUnsafe(
                'CREATE TEMP TABLE "FlightScheduleProvenanceAirportProbe" '
                + '("iataCode" TEXT PRIMARY KEY, "label" TEXT UNIQUE NOT NULL, "timeZone" TEXT NOT NULL) '
                + 'ON COMMIT DROP',
            );
            await tx.$executeRawUnsafe(
                'CREATE TEMP TABLE "FlightScheduleProvenanceScheduleProbe" '
                + '("id" INTEGER PRIMARY KEY, "flightNumber" TEXT NOT NULL, "from" TEXT NOT NULL, '
                + '"to" TEXT NOT NULL, "departureTime" TEXT NOT NULL, "daysOfWeek" INTEGER[] NOT NULL) '
                + 'ON COMMIT DROP',
            );
            await tx.$executeRawUnsafe(
                'CREATE TEMP TABLE "FlightScheduleProvenanceFlightProbe" '
                + '("id" INTEGER PRIMARY KEY, "flightNumber" TEXT NOT NULL, '
                + '"fromAirportCode" TEXT NOT NULL, "toAirportCode" TEXT NOT NULL, '
                + '"departureDate" TIMESTAMPTZ NOT NULL, "flightScheduleId" INTEGER) ON COMMIT DROP',
            );
            await tx.$executeRawUnsafe(
                `INSERT INTO "FlightScheduleProvenanceAirportProbe" VALUES
                ('SEA', 'Seattle, USA', 'America/Los_Angeles'),
                ('DTW', 'Detroit, USA', 'America/Detroit'),
                ('JFK', 'New York, USA', 'America/New_York')`,
            );
            await tx.$executeRawUnsafe(
                `INSERT INTO "FlightScheduleProvenanceScheduleProbe" VALUES
                (7001, 'P237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[1]),
                (7002, 'A237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[1]),
                (7003, 'A237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[1]),
                (7004, 'O237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[1]),
                (7005, 'D237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[1]),
                (7006, 'T237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[1]),
                (7007, 'W237', 'Seattle, USA', 'Detroit, USA', '08:00', ARRAY[2])`,
            );
            await tx.$executeRawUnsafe(
                `INSERT INTO "FlightScheduleProvenanceFlightProbe" VALUES
                (7101, 'P237', 'SEA', 'DTW', '2026-08-17 15:00:00+00', NULL),
                (7102, 'M237', 'SEA', 'DTW', '2026-08-17 15:00:00+00', NULL),
                (7103, 'A237', 'SEA', 'DTW', '2026-08-17 15:00:00+00', NULL),
                (7104, 'O237', 'JFK', 'DTW', '2026-08-17 12:00:00+00', NULL),
                (7105, 'D237', 'SEA', 'JFK', '2026-08-17 15:00:00+00', NULL),
                (7106, 'T237', 'SEA', 'DTW', '2026-08-17 16:00:00+00', NULL),
                (7107, 'W237', 'SEA', 'DTW', '2026-08-17 15:00:00+00', NULL)`,
            );

            await tx.$executeRawUnsafe(
                backfill!
                    .replaceAll('"Flight"', '"FlightScheduleProvenanceFlightProbe"')
                    .replaceAll('"Airport"', '"FlightScheduleProvenanceAirportProbe"')
                    .replaceAll('"FlightSchedule"', '"FlightScheduleProvenanceScheduleProbe"'),
            );

            const rows = await tx.$queryRawUnsafe<Array<{
                id: number;
                flightScheduleId: number | null;
            }>>(
                'SELECT "id", "flightScheduleId" FROM "FlightScheduleProvenanceFlightProbe" ORDER BY "id"',
            );

            expect(rows).toEqual([
                { id: 7101, flightScheduleId: 7001 },
                { id: 7102, flightScheduleId: null },
                { id: 7103, flightScheduleId: null },
                { id: 7104, flightScheduleId: null },
                { id: 7105, flightScheduleId: null },
                { id: 7106, flightScheduleId: null },
                { id: 7107, flightScheduleId: null },
            ]);
        });
    });

    it('ships an indexed set-null foreign key for the provenance relation', async () => {
        const migration = fs.readFileSync(path.join(
            process.cwd(),
            'prisma/migrations/20260817070000_link_flights_to_schedules/migration.sql',
        ), 'utf8');
        const column = migration.match(
            /ALTER TABLE "Flight" ADD COLUMN "flightScheduleId" INTEGER;/,
        )?.[0];
        const index = migration.match(
            /CREATE INDEX "Flight_flightScheduleId_idx" ON "Flight"\("flightScheduleId"\);/,
        )?.[0];
        const foreignKey = migration.match(
            /ALTER TABLE "Flight"\s+ADD CONSTRAINT "Flight_flightScheduleId_fkey"[\s\S]*?ON DELETE SET NULL ON UPDATE CASCADE;/,
        )?.[0];

        expect(column).toBeDefined();
        expect(index).toBeDefined();
        expect(foreignKey).toBeDefined();

        await prisma.$transaction(async tx => {
            await tx.$executeRawUnsafe(
                'CREATE TEMP TABLE "FlightScheduleProvenanceFkScheduleProbe" '
                + '("id" INTEGER PRIMARY KEY) ON COMMIT DROP',
            );
            await tx.$executeRawUnsafe(
                'CREATE TEMP TABLE "FlightScheduleProvenanceFkFlightProbe" '
                + '("id" INTEGER PRIMARY KEY) ON COMMIT DROP',
            );
            await tx.$executeRawUnsafe(
                column!.replaceAll('"Flight"', '"FlightScheduleProvenanceFkFlightProbe"'),
            );
            await tx.$executeRawUnsafe(
                index!
                    .replaceAll('"Flight_flightScheduleId_idx"', '"FlightScheduleProvenanceProbe_idx"')
                    .replaceAll('"Flight"', '"FlightScheduleProvenanceFkFlightProbe"'),
            );
            await tx.$executeRawUnsafe(
                foreignKey!
                    .replaceAll('"Flight_flightScheduleId_fkey"', '"FlightScheduleProvenanceProbe_fkey"')
                    .replaceAll('"Flight"', '"FlightScheduleProvenanceFkFlightProbe"')
                    .replaceAll('"FlightSchedule"', '"FlightScheduleProvenanceFkScheduleProbe"'),
            );

            await tx.$executeRawUnsafe(
                'INSERT INTO "FlightScheduleProvenanceFkScheduleProbe" VALUES (1)',
            );
            await tx.$executeRawUnsafe(
                'INSERT INTO "FlightScheduleProvenanceFkFlightProbe" VALUES (2, 1)',
            );
            await tx.$executeRawUnsafe(
                'DELETE FROM "FlightScheduleProvenanceFkScheduleProbe" WHERE "id" = 1',
            );

            const rows = await tx.$queryRawUnsafe<Array<{
                id: number;
                flightScheduleId: number | null;
            }>>(
                'SELECT "id", "flightScheduleId" FROM "FlightScheduleProvenanceFkFlightProbe"',
            );
            const indexes = await tx.$queryRawUnsafe<Array<{ indexname: string }>>(
                "SELECT indexname FROM pg_indexes WHERE tablename = 'FlightScheduleProvenanceFkFlightProbe'",
            );

            expect(rows).toEqual([{ id: 2, flightScheduleId: null }]);
            expect(indexes).toEqual(expect.arrayContaining([
                { indexname: 'FlightScheduleProvenanceProbe_idx' },
            ]));
        });
    });
});
