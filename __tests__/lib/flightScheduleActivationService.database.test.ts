/** @jest-environment node */

import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import FlightScheduleService from '@/lib/FlightScheduleService';
import {
    FlightScheduleActivationService,
    lockFlightScheduleForUpdate,
} from '@/lib/flightScheduleActivationService';
import {
    lockFlightScheduleGenerationState,
    withFlightScheduleGenerationLock,
} from '@/lib/flightScheduleGenerationLock';
import { prisma } from '@/lib/prisma';

describe('flight schedule activation in PostgreSQL', () => {
    const created = {
        bookingIds: [] as number[],
        flightIds: [] as number[],
        scheduleIds: [] as number[],
    };

    afterEach(async () => {
        await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        await prisma.flightSchedule.deleteMany({ where: { id: { in: created.scheduleIds } } });
        created.bookingIds.length = 0;
        created.flightIds.length = 0;
        created.scheduleIds.length = 0;
    });

    it('deactivates reversibly while preserving linked flights and bookings', async () => {
        const suffix = randomUUID().slice(0, 6).toUpperCase();
        const schedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: `D${suffix}`,
                airline: 'Deactivation Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1],
                priceCents: 35_000,
            },
        });
        created.scheduleIds.push(schedule.id);
        const flight = await prisma.flight.create({
            data: {
                flightScheduleId: schedule.id,
                flightNumber: schedule.flightNumber,
                airline: schedule.airline,
                fromAirportCode: 'SEA',
                toAirportCode: 'DTW',
                departureDate: new Date('2027-01-11T16:00:00.000Z'),
                durationMinutes: schedule.durationMinutes,
                priceCents: schedule.priceCents,
                status: 'ON_TIME',
            },
        });
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: flight.id }] } },
        });
        created.bookingIds.push(booking.id);

        await expect(new FlightScheduleActivationService().setActive(schedule.id, false))
            .resolves.toEqual({
                flightScheduleId: schedule.id,
                isActive: false,
                changed: true,
                preservedOccurrenceCount: 1,
            });
        await expect(new FlightScheduleActivationService().setActive(schedule.id, false))
            .resolves.toMatchObject({ changed: false, preservedOccurrenceCount: 1 });

        await expect(prisma.flightSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
            .resolves.toMatchObject({ isActive: false });
        await expect(prisma.flight.findUniqueOrThrow({ where: { id: flight.id } }))
            .resolves.toMatchObject({ flightScheduleId: schedule.id });
        await expect(prisma.booking.findUniqueOrThrow({
            where: { id: booking.id },
            include: { legs: true },
        })).resolves.toMatchObject({ legs: [{ flightId: flight.id }] });

        await expect(new FlightScheduleActivationService().setActive(schedule.id, true))
            .resolves.toMatchObject({ isActive: true, changed: true, preservedOccurrenceCount: 1 });
    });

    it('waits for an in-flight generator lock before reporting deactivation success', async () => {
        const schedule = await createSchedule();
        const blocker = new PrismaClient();
        let releaseLock!: () => void;
        let lockHeld!: () => void;
        const release = new Promise<void>(resolve => { releaseLock = resolve; });
        const locked = new Promise<void>(resolve => { lockHeld = resolve; });
        let blockerPid = 0;

        const holder = blocker.$transaction(async tx => {
            const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`
                SELECT pg_backend_pid() AS "pid"
            `;
            blockerPid = connection.pid;
            await lockFlightScheduleGenerationState(tx, schedule.id);
            lockHeld();
            await release;
        });

        try {
            await locked;
            const deactivation = new FlightScheduleActivationService().setActive(schedule.id, false);
            await waitUntilBlockedBy(blockerPid);
            await expect(prisma.flightSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
                .resolves.toMatchObject({ isActive: true });
            releaseLock();
            await holder;
            await expect(deactivation).resolves.toMatchObject({ isActive: false, changed: true });
        } finally {
            releaseLock();
            await holder;
            await blocker.$disconnect();
        }
    });

    it('holds the shared generation-state lock until the product callback finishes', async () => {
        const schedule = await createSchedule();
        const contender = new PrismaClient();
        let releaseCallback!: () => void;
        let callbackEntered!: () => void;
        const release = new Promise<void>(resolve => { releaseCallback = resolve; });
        const entered = new Promise<void>(resolve => { callbackEntered = resolve; });
        let holderPid = 0;

        const holder = withFlightScheduleGenerationLock(schedule.id, async tx => {
            const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`
                SELECT pg_backend_pid() AS "pid"
            `;
            holderPid = connection.pid;
            callbackEntered();
            await release;
        });

        let waiting: Promise<void> | undefined;

        try {
            await entered;
            waiting = contender.$transaction(async tx => {
                await lockFlightScheduleGenerationState(tx, schedule.id);
            });
            await waitUntilBlockedBy(holderPid);
            releaseCallback();
            await expect(holder).resolves.toBeUndefined();
            await expect(waiting).resolves.toBeUndefined();
        } finally {
            releaseCallback();
            await holder;
            if (waiting) await waiting;
            await contender.$disconnect();
        }
    });

    it('holds the schedule row lock against a direct competing update', async () => {
        const schedule = await createSchedule();
        const holderClient = new PrismaClient();
        const contender = new PrismaClient();
        let releaseRowLock!: () => void;
        let rowLocked!: () => void;
        const release = new Promise<void>(resolve => { releaseRowLock = resolve; });
        const locked = new Promise<void>(resolve => { rowLocked = resolve; });
        let holderPid = 0;

        const holder = holderClient.$transaction(async tx => {
            const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`
                SELECT pg_backend_pid() AS "pid"
            `;
            holderPid = connection.pid;
            await expect(lockFlightScheduleForUpdate(tx, schedule.id)).resolves.toBe(true);
            rowLocked();
            await release;
        });

        try {
            await locked;
            const update = contender.flightSchedule.update({
                where: { id: schedule.id },
                data: { isActive: false },
            }).then(result => result);
            await waitUntilBlockedBy(holderPid);
            await expect(prisma.flightSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
                .resolves.toMatchObject({ isActive: true });
            releaseRowLock();
            await holder;
            await expect(update).resolves.toMatchObject({ isActive: false });
        } finally {
            releaseRowLock();
            await holder;
            await holderClient.$disconnect();
            await contender.$disconnect();
        }
    });

    it('does not create from a stale active candidate after deactivation wins the lock', async () => {
        const schedule = await createSchedule();
        const blocker = new PrismaClient();
        let releaseLock!: () => void;
        let lockHeld!: () => void;
        const release = new Promise<void>(resolve => { releaseLock = resolve; });
        const locked = new Promise<void>(resolve => { lockHeld = resolve; });
        let blockerPid = 0;

        const deactivation = blocker.$transaction(async tx => {
            const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`
                SELECT pg_backend_pid() AS "pid"
            `;
            blockerPid = connection.pid;
            await lockFlightScheduleGenerationState(tx, schedule.id);
            await tx.flightSchedule.update({
                where: { id: schedule.id },
                data: { isActive: false },
            });
            lockHeld();
            await release;
        });

        try {
            await locked;
            const generation = new FlightScheduleService().ensureFlightsForDate(
                new Date('2027-01-11T12:00:00.000Z'),
            );
            await waitUntilBlockedBy(blockerPid);
            releaseLock();
            await deactivation;

            const generated = await generation;
            expect(generated.map(({ flight }) => flight.flightScheduleId))
                .not.toContain(schedule.id);
            await expect(prisma.flight.count({
                where: { flightScheduleId: schedule.id },
            })).resolves.toBe(0);
        } finally {
            releaseLock();
            await deactivation;
            await blocker.$disconnect();
        }
    });

    async function createSchedule() {
        const suffix = randomUUID().slice(0, 6).toUpperCase();
        const schedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: `L${suffix}`,
                airline: 'Lock Airways',
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
        throw new Error('Schedule operation did not wait for the expected database lock.');
    }
});
