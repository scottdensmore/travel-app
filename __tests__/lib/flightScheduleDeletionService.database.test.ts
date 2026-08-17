/** @jest-environment node */

import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { airportCodesForRoute } from '@/lib/airports';
import { FlightScheduleDeletionService } from '@/lib/flightScheduleDeletionService';
import { prisma } from '@/lib/prisma';

describe('permanent flight schedule deletion', () => {
    const created = {
        bookingIds: [] as number[],
        deletionIds: [] as string[],
        flightIds: [] as number[],
        scheduleIds: [] as number[],
        termsRequestIds: [] as string[],
        userIds: [] as string[],
    };

    afterEach(async () => {
        await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        await prisma.flightSchedule.deleteMany({ where: { id: { in: created.scheduleIds } } });
        await removeTermsChangeAudits(created.termsRequestIds);
        await removeDeletionReceipts(created.deletionIds, created.scheduleIds);
        await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
        for (const ids of Object.values(created)) ids.length = 0;
    });

    it('deletes only the inactive template and preserves linked customer history plus immutable audits', async () => {
        const actor = await prisma.user.create({
            data: { email: `schedule-delete-${randomUUID()}@example.com`, role: 'ADMIN' },
        });
        created.userIds.push(actor.id);
        const suffix = randomUUID().slice(0, 8);
        const schedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: `DEL-${suffix}`,
                airline: 'Mona Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1, 3, 5],
                priceCents: 35_000,
                isActive: false,
                firstClassRows: 3,
                businessRows: 3,
                premiumEconomyRows: 4,
                economyRows: 20,
                seatPattern: 'ABC-DEF',
            },
        });
        created.scheduleIds.push(schedule.id);
        const termsRequestId = randomUUID();
        created.termsRequestIds.push(termsRequestId);
        const terms = await prisma.flightScheduleTermsChange.create({
            data: {
                requestId: termsRequestId,
                flightScheduleId: schedule.id,
                actorUserId: actor.id,
                fromDurationMinutes: 240,
                toDurationMinutes: 245,
                fromPriceCents: 34_000,
                toPriceCents: 35_000,
                updatedOccurrenceCount: 0,
                protectedOccurrenceCount: 0,
            },
        });
        const now = Date.now();
        const route = airportCodesForRoute(schedule.from, schedule.to);
        const flights = await Promise.all([
            createFlight(schedule.id, schedule.flightNumber, new Date(now - 24 * 60 * 60 * 1000), route),
            createFlight(schedule.id, schedule.flightNumber, new Date(now + 72 * 60 * 60 * 1000), route),
            createFlight(schedule.id, schedule.flightNumber, new Date(now + 96 * 60 * 60 * 1000), route),
        ]);
        created.flightIds.push(...flights.map(flight => flight.id));
        const booking = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: flights[2].id }] } },
        });
        created.bookingIds.push(booking.id);
        const requestId = randomUUID();

        const result = await new FlightScheduleDeletionService().delete({
            requestId,
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
        });
        created.deletionIds.push(result.deletionId);
        created.scheduleIds = created.scheduleIds.filter(id => id !== schedule.id);

        expect(result).toMatchObject({
            flightScheduleId: schedule.id,
            occurrenceCount: 3,
            protectedOccurrenceCount: 2,
            wasDeleted: true,
        });
        await expect(prisma.flightSchedule.findUnique({ where: { id: schedule.id } }))
            .resolves.toBeNull();
        await expect(prisma.flight.findMany({
            where: { id: { in: flights.map(flight => flight.id) } },
            orderBy: { id: 'asc' },
            select: { flightScheduleId: true },
        })).resolves.toEqual(flights.map(() => ({ flightScheduleId: null })));
        await expect(prisma.booking.findUnique({ where: { id: booking.id } }))
            .resolves.toMatchObject({ id: booking.id });
        await expect(prisma.flightScheduleTermsChange.findUniqueOrThrow({ where: { id: terms.id } }))
            .resolves.toMatchObject({ flightScheduleId: schedule.id, requestId: termsRequestId });

        const receipt = await prisma.flightScheduleDeletion.findUniqueOrThrow({
            where: { id: result.deletionId },
        });
        expect(receipt).toEqual(expect.objectContaining({
            requestId,
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
            flightNumber: schedule.flightNumber,
            airline: schedule.airline,
            from: schedule.from,
            to: schedule.to,
            departureTime: schedule.departureTime,
            durationMinutes: schedule.durationMinutes,
            daysOfWeek: schedule.daysOfWeek,
            priceCents: schedule.priceCents,
            firstClassRows: schedule.firstClassRows,
            businessRows: schedule.businessRows,
            premiumEconomyRows: schedule.premiumEconomyRows,
            economyRows: schedule.economyRows,
            seatPattern: schedule.seatPattern,
            occurrenceCount: 3,
            protectedOccurrenceCount: 2,
        }));
        await expect(prisma.flightScheduleDeletion.update({
            where: { id: receipt.id },
            data: { flightNumber: 'FORGED' },
        })).rejects.toThrow(/append-only/);
        await expect(prisma.flightScheduleDeletion.delete({ where: { id: receipt.id } }))
            .rejects.toThrow(/cannot be deleted/);
        await expect(prisma.$transaction(async tx => {
            await tx.flightScheduleDeletion.delete({ where: { id: receipt.id } });
            await tx.flightScheduleDeletion.create({
                data: { ...receipt, deletedAt: new Date('2000-01-01T00:00:00.000Z') },
            });
        })).rejects.toThrow(/cannot be deleted/);
        await expect(prisma.flightScheduleDeletion.findUniqueOrThrow({ where: { id: receipt.id } }))
            .resolves.toMatchObject({ deletedAt: receipt.deletedAt });
        await expect(new FlightScheduleDeletionService().delete({
            requestId,
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
        })).resolves.toEqual({ ...result, wasDeleted: false });

        await prisma.user.delete({ where: { id: actor.id } });
        created.userIds = created.userIds.filter(id => id !== actor.id);
        await expect(prisma.flightScheduleDeletion.findUniqueOrThrow({ where: { id: receipt.id } }))
            .resolves.toMatchObject({ actorUserId: null, flightScheduleId: schedule.id });
    });

    it('enforces receipt identity and value bounds in PostgreSQL', async () => {
        const schedule = await createInactiveSchedule('BOUND');
        const secondSchedule = await createInactiveSchedule('BOUND-OTHER');
        created.scheduleIds.push(schedule.id, secondSchedule.id);
        const requestId = randomUUID();
        await expect(prisma.flightScheduleDeletion.create({
            data: { ...deletionReceiptData(schedule, '') },
        })).rejects.toThrow(/request_nonempty/);
        await expectReceiptConstraintFailure(
            { ...deletionReceiptData(schedule, randomUUID()), flightScheduleId: 0 },
            /schedule_positive/,
        );
        await expectReceiptConstraintFailure(
            { ...deletionReceiptData(schedule, randomUUID()), durationMinutes: 0 },
            /duration_positive/,
        );
        await expectReceiptConstraintFailure(
            { ...deletionReceiptData(schedule, randomUUID()), durationMinutes: 4_321 },
            /duration_positive/,
        );
        await expectReceiptConstraintFailure(
            { ...deletionReceiptData(schedule, randomUUID()), priceCents: -1 },
            /price_nonnegative/,
        );
        await expect(prisma.flightScheduleDeletion.create({
            data: { ...deletionReceiptData(schedule, randomUUID()), occurrenceCount: -1 },
        })).rejects.toThrow(/counts_valid/);
        await expect(prisma.flightScheduleDeletion.create({
            data: { ...deletionReceiptData(schedule, randomUUID()), protectedOccurrenceCount: -1 },
        })).rejects.toThrow(/counts_valid/);
        await expect(prisma.flightScheduleDeletion.create({
            data: {
                ...deletionReceiptData(schedule, randomUUID()),
                occurrenceCount: 1,
                protectedOccurrenceCount: 2,
            },
        })).rejects.toThrow(/counts_valid/);
        await expect(prisma.flightScheduleDeletion.create({
            data: { ...deletionReceiptData(schedule, randomUUID()), flightNumber: 'FORGED' },
        })).rejects.toThrow(/must exactly snapshot inactive schedule/);

        const activeSchedule = await createInactiveSchedule('BOUND-ACTIVE', true);
        created.scheduleIds.push(activeSchedule.id);
        await expect(prisma.flightScheduleDeletion.create({
            data: deletionReceiptData(activeSchedule, randomUUID()),
        })).rejects.toThrow(/must exactly snapshot inactive schedule/);

        const forgedDeletedAt = new Date('2000-01-01T00:00:00.000Z');
        const valid = deletionReceiptData(schedule, requestId);
        const beforeInsert = Date.now();
        const stored = await prisma.flightScheduleDeletion.create({
            data: { ...valid, deletedAt: forgedDeletedAt },
        });
        const afterInsert = Date.now();
        created.deletionIds.push(stored.id);
        expect(stored.deletedAt.getTime()).toBeGreaterThanOrEqual(beforeInsert);
        expect(stored.deletedAt.getTime()).toBeLessThanOrEqual(afterInsert);
        await expect(prisma.flightScheduleDeletion.create({
            data: deletionReceiptData(secondSchedule, requestId),
        })).rejects.toThrow(/requestId/);
        await expect(prisma.flightScheduleDeletion.create({
            data: deletionReceiptData(schedule, randomUUID()),
        })).rejects.toThrow(/flightScheduleId/);
    });

    it('waits for a linked occurrence mutation before counting protected history', async () => {
        const actor = await prisma.user.create({
            data: { email: `schedule-delete-lock-${randomUUID()}@example.com`, role: 'ADMIN' },
        });
        created.userIds.push(actor.id);
        const schedule = await createInactiveSchedule('LOCK');
        created.scheduleIds.push(schedule.id);
        const route = airportCodesForRoute(schedule.from, schedule.to);
        const flight = await createFlight(
            schedule.id,
            schedule.flightNumber,
            new Date(Date.now() + 72 * 60 * 60 * 1_000),
            route,
        );
        created.flightIds.push(flight.id);

        const blocker = new PrismaClient();
        let releaseBlocker!: () => void;
        const release = new Promise<void>(resolve => { releaseBlocker = resolve; });
        let locked!: () => void;
        const lockReady = new Promise<void>(resolve => { locked = resolve; });
        let blockerPid = 0;
        const bookingWork = blocker.$transaction(async tx => {
            const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`
                SELECT pg_backend_pid() AS "pid"
            `;
            blockerPid = connection.pid;
            await tx.$queryRaw`
                SELECT "id" FROM "Flight" WHERE "id" = ${flight.id} FOR UPDATE
            `;
            locked();
            await release;
            const booking = await tx.booking.create({
                data: { legs: { create: [{ sequence: 1, flightId: flight.id }] } },
            });
            created.bookingIds.push(booking.id);
        });

        await lockReady;
        const deletion = new FlightScheduleDeletionService().delete({
            requestId: randomUUID(),
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
        });
        await waitUntilBlockedBy(blockerPid);
        releaseBlocker();
        await bookingWork;

        const result = await deletion;
        created.deletionIds.push(result.deletionId);
        created.scheduleIds = created.scheduleIds.filter(id => id !== schedule.id);
        expect(result).toMatchObject({
            occurrenceCount: 1,
            protectedOccurrenceCount: 1,
            wasDeleted: true,
        });
        await blocker.$disconnect();
    });
});

async function createFlight(
    flightScheduleId: number,
    flightNumber: string,
    departureDate: Date,
    route: { fromAirportCode: string; toAirportCode: string },
) {
    return prisma.flight.create({
        data: {
            flightScheduleId,
            flightNumber,
            airline: 'Mona Airways',
            ...route,
            departureDate,
            durationMinutes: 245,
            priceCents: 35_000,
            status: 'ON_TIME',
        },
    });
}

async function removeDeletionReceipts(ids: string[], flightScheduleIds: number[]): Promise<void> {
    if (ids.length === 0 && flightScheduleIds.length === 0) return;
    if (process.env.DATABASE_IS_DISPOSABLE !== 'true') {
        throw new Error('Refusing to clean immutable schedule-deletion receipts outside a disposable database.');
    }
    await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.flightScheduleDeletion.deleteMany({
            where: {
                OR: [
                    { id: { in: ids } },
                    { flightScheduleId: { in: flightScheduleIds } },
                ],
            },
        });
    });
}

async function removeTermsChangeAudits(requestIds: string[]): Promise<void> {
    if (requestIds.length === 0) return;
    if (process.env.DATABASE_IS_DISPOSABLE !== 'true') {
        throw new Error('Refusing to clean immutable schedule-terms audits outside a disposable database.');
    }
    await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.flightScheduleTermsChange.deleteMany({
            where: { requestId: { in: requestIds } },
        });
    });
}

async function expectReceiptConstraintFailure(
    data: ReturnType<typeof deletionReceiptData> & { deletedAt?: Date },
    constraint: RegExp,
): Promise<void> {
    await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.flightScheduleDeletion.create({ data });
        throw new Error('Receipt constraint did not reject the invalid row.');
    })).rejects.toThrow(constraint);
}

async function waitUntilBlockedBy(blockerPid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const [state] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT EXISTS (
                SELECT 1
                FROM pg_stat_activity activity
                WHERE ${blockerPid} = ANY(pg_blocking_pids(activity.pid))
            ) AS "blocked"
        `;
        if (state.blocked) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Schedule deletion did not wait for the competing flight lock.');
}

function deletionReceiptData(
    schedule: Awaited<ReturnType<typeof createInactiveSchedule>>,
    requestId: string,
) {
    return {
        requestId,
        flightScheduleId: schedule.id,
        actorUserId: null,
        flightNumber: schedule.flightNumber,
        airline: schedule.airline,
        from: schedule.from,
        to: schedule.to,
        departureTime: schedule.departureTime,
        durationMinutes: schedule.durationMinutes,
        daysOfWeek: schedule.daysOfWeek,
        priceCents: schedule.priceCents,
        firstClassRows: schedule.firstClassRows,
        businessRows: schedule.businessRows,
        premiumEconomyRows: schedule.premiumEconomyRows,
        economyRows: schedule.economyRows,
        seatPattern: schedule.seatPattern,
        occurrenceCount: 1,
        protectedOccurrenceCount: 1,
    };
}

async function createInactiveSchedule(prefix: string, isActive = false) {
    const schedule = await prisma.flightSchedule.create({
        data: {
            flightNumber: `${prefix}-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureTime: '08:00',
            durationMinutes: 245,
            daysOfWeek: [1, 3, 5],
            priceCents: 35_000,
            isActive,
            firstClassRows: 3,
            businessRows: 3,
            premiumEconomyRows: 4,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
        },
    });
    return schedule;
}
