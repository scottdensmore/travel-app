/** @jest-environment node */

import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { FlightScheduleTermsService } from '@/lib/flightScheduleTermsService';
import { prisma } from '@/lib/prisma';
import { holdSeats } from '@/lib/seatHolds';

describe('audited flight schedule duration and fare updates', () => {
    const created = {
        userIds: [] as string[],
        bookingIds: [] as number[],
        flightIds: [] as number[],
        scheduleIds: [] as number[],
        termsRequestIds: [] as string[],
    };

    afterEach(async () => {
        await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        await prisma.flightSchedule.deleteMany({ where: { id: { in: created.scheduleIds } } });
        await removeTermsChangeAudits(created.termsRequestIds);
        await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
        created.userIds.length = 0;
        created.bookingIds.length = 0;
        created.flightIds.length = 0;
        created.scheduleIds.length = 0;
        created.termsRequestIds.length = 0;
    });

    it('updates only safe linked occurrences, preserves protected rows, and retries from immutable audit', async () => {
        const actor = await createActor();
        const schedule = await createSchedule();
        const now = new Date();
        const historical = await createFlight(schedule.id, -1);
        const booked = await createFlight(schedule.id, 72);
        const held = await createFlight(schedule.id, 96);
        const delayed = await createFlight(schedule.id, 120, 'DELAYED');
        const safe = await createFlight(schedule.id, 144);
        const unlinked = await createFlight(null, 168);

        const booking = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: booked.id }] } },
        });
        created.bookingIds.push(booking.id);
        await holdSeats([{
            flightId: held.id,
            seatNumber: '11A',
            holderKey: `schedule-terms:${randomUUID()}`,
        }]);

        const request = {
            requestId: randomUUID(),
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
            durationMinutes: 255,
            priceCents: 37_500,
        };
        created.termsRequestIds.push(request.requestId);
        const first = await new FlightScheduleTermsService().update(request);

        expect(first).toMatchObject({
            flightScheduleId: schedule.id,
            durationMinutes: 255,
            priceCents: 37_500,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 4,
            wasApplied: true,
        });
        await expect(prisma.flightSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
            .resolves.toMatchObject({ durationMinutes: 255, priceCents: 37_500 });

        const terms = await prisma.flight.findMany({
            where: { id: { in: [historical.id, booked.id, held.id, delayed.id, safe.id, unlinked.id] } },
            orderBy: { id: 'asc' },
            select: { id: true, durationMinutes: true, priceCents: true },
        });
        const byId = new Map(terms.map(row => [row.id, row]));
        for (const protectedFlight of [historical, booked, held, delayed, unlinked]) {
            expect(byId.get(protectedFlight.id)).toEqual({
                id: protectedFlight.id,
                durationMinutes: 245,
                priceCents: 35_000,
            });
        }
        expect(byId.get(safe.id)).toEqual({
            id: safe.id,
            durationMinutes: 255,
            priceCents: 37_500,
        });

        const stored = await prisma.flightScheduleTermsChange.findUniqueOrThrow({
            where: { requestId: request.requestId },
        });
        expect(stored).toMatchObject({
            id: first.changeId,
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
            fromDurationMinutes: 245,
            toDurationMinutes: 255,
            fromPriceCents: 35_000,
            toPriceCents: 37_500,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 4,
        });

        await expect(new FlightScheduleTermsService().update(request)).resolves.toEqual({
            ...first,
            wasApplied: false,
        });
        await expect(prisma.flightScheduleTermsChange.count({
            where: { requestId: request.requestId },
        })).resolves.toBe(1);

        await expect(prisma.flightScheduleTermsChange.update({
            where: { id: stored.id },
            data: { toPriceCents: 1 },
        })).rejects.toThrow(/append-only/);
        await expect(prisma.flightScheduleTermsChange.delete({
            where: { id: stored.id },
        })).rejects.toThrow(/cannot be deleted/);
        await expect(prisma.$transaction(async tx => {
            await tx.flightScheduleTermsChange.delete({ where: { id: stored.id } });
            await tx.flightScheduleTermsChange.create({
                data: {
                    id: stored.id,
                    requestId: stored.requestId,
                    flightScheduleId: stored.flightScheduleId,
                    actorUserId: stored.actorUserId,
                    fromDurationMinutes: stored.fromDurationMinutes,
                    toDurationMinutes: stored.toDurationMinutes,
                    fromPriceCents: stored.fromPriceCents,
                    toPriceCents: stored.toPriceCents,
                    updatedOccurrenceCount: stored.updatedOccurrenceCount,
                    protectedOccurrenceCount: stored.protectedOccurrenceCount,
                    createdAt: new Date('2000-01-01T00:00:00.000Z'),
                },
            });
        })).rejects.toThrow(/cannot be deleted/);
        await expect(prisma.flightScheduleTermsChange.findUniqueOrThrow({
            where: { id: stored.id },
        })).resolves.toMatchObject({ createdAt: stored.createdAt });

        await prisma.user.delete({ where: { id: actor.id } });
        created.userIds = created.userIds.filter(id => id !== actor.id);
        await expect(prisma.flightScheduleTermsChange.findUniqueOrThrow({
            where: { id: stored.id },
        })).resolves.toMatchObject({
            actorUserId: null,
            toDurationMinutes: 255,
            toPriceCents: 37_500,
        });

        // Permanent schedule deletion preserves both the audit and the
        // historical identifier of its removed subject.
        await prisma.booking.delete({ where: { id: booking.id } });
        created.bookingIds = created.bookingIds.filter(id => id !== booking.id);
        await prisma.flight.deleteMany({
            where: { id: { in: [historical.id, booked.id, held.id, delayed.id, safe.id] } },
        });
        created.flightIds = created.flightIds.filter(id => ![historical.id, booked.id, held.id, delayed.id, safe.id].includes(id));
        await prisma.flightSchedule.delete({ where: { id: schedule.id } });
        created.scheduleIds = created.scheduleIds.filter(id => id !== schedule.id);
        await expect(prisma.flightScheduleTermsChange.findUniqueOrThrow({ where: { id: stored.id } }))
            .resolves.toMatchObject({ flightScheduleId: schedule.id, createdAt: stored.createdAt });
        await expect(prisma.flightScheduleTermsChange.delete({ where: { id: stored.id } }))
            .rejects.toThrow(/cannot be deleted/);

        expect(historical.departureDate.getTime()).toBeLessThan(now.getTime());
    });

    it('re-reads protection after waiting on the occurrence lock', async () => {
        const actor = await createActor();
        const schedule = await createSchedule();
        const flight = await createFlight(schedule.id, 72);
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
        const requestId = randomUUID();
        created.termsRequestIds.push(requestId);
        const update = new FlightScheduleTermsService().update({
            requestId,
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
            durationMinutes: 260,
            priceCents: 38_000,
        });
        await waitUntilBlockedBy(blockerPid);
        releaseBlocker();
        await bookingWork;

        await expect(update).resolves.toMatchObject({
            updatedOccurrenceCount: 0,
            protectedOccurrenceCount: 1,
        });
        await expect(prisma.flight.findUniqueOrThrow({ where: { id: flight.id } }))
            .resolves.toMatchObject({ durationMinutes: 245, priceCents: 35_000 });
        await blocker.$disconnect();
    });

    it('enforces request uniqueness and value bounds in PostgreSQL', async () => {
        const actor = await createActor();
        const schedule = await createSchedule();
        const requestId = randomUUID();
        created.termsRequestIds.push(requestId);
        const valid = {
            requestId,
            flightScheduleId: schedule.id,
            actorUserId: actor.id,
            fromDurationMinutes: 245,
            toDurationMinutes: 255,
            fromPriceCents: 35_000,
            toPriceCents: 37_500,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 0,
        };
        await prisma.flightScheduleTermsChange.create({ data: valid });

        await expect(prisma.flightScheduleTermsChange.create({ data: valid }))
            .rejects.toThrow(/requestId/);
        const missingSubjectRequestId = randomUUID();
        created.termsRequestIds.push(missingSubjectRequestId);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: missingSubjectRequestId, flightScheduleId: 987_654_321 },
        })).rejects.toThrow(/must name an existing schedule/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: '' },
        })).rejects.toThrow(/request_nonempty/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), toDurationMinutes: 0 },
        })).rejects.toThrow(/duration_positive/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), fromDurationMinutes: 0 },
        })).rejects.toThrow(/duration_positive/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), toDurationMinutes: 4_321 },
        })).rejects.toThrow(/duration_positive/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), fromDurationMinutes: 4_321 },
        })).rejects.toThrow(/duration_positive/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), toPriceCents: -1 },
        })).rejects.toThrow(/price_nonnegative/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), fromPriceCents: -1 },
        })).rejects.toThrow(/price_nonnegative/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), protectedOccurrenceCount: -1 },
        })).rejects.toThrow(/counts_nonnegative/);
        await expect(prisma.flightScheduleTermsChange.create({
            data: { ...valid, requestId: randomUUID(), updatedOccurrenceCount: -1 },
        })).rejects.toThrow(/counts_nonnegative/);
    });

    async function createActor() {
        const suffix = randomUUID();
        const user = await prisma.user.create({
            data: { name: 'Schedule Editor', email: `schedule-editor-${suffix}@example.com` },
        });
        created.userIds.push(user.id);
        return user;
    }

    async function createSchedule() {
        const suffix = randomUUID().slice(0, 6).toUpperCase();
        const schedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: `T${suffix}`,
                airline: 'Terms Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1],
                priceCents: 35_000,
            },
        });
        created.scheduleIds.push(schedule.id);
        return schedule;
    }

    async function createFlight(
        flightScheduleId: number | null,
        offsetHours: number,
        status: 'ON_TIME' | 'DELAYED' = 'ON_TIME',
    ) {
        const flight = await prisma.flight.create({
            data: {
                flightScheduleId,
                flightNumber: `TERM-${randomUUID().slice(0, 8)}`,
                airline: 'Terms Airways',
                fromAirportCode: 'SEA',
                toAirportCode: 'DTW',
                departureDate: new Date(Date.now() + offsetHours * 60 * 60 * 1_000),
                durationMinutes: 245,
                priceCents: 35_000,
                status,
            },
        });
        created.flightIds.push(flight.id);
        return flight;
    }

    async function waitUntilBlockedBy(blockerPid: number) {
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
        throw new Error('Schedule update did not wait for the competing flight lock.');
    }
});

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
