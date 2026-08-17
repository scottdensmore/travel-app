import { Prisma } from '@prisma/client';
import { classifyScheduleOccurrence } from '@/lib/flightScheduleImpact';
import { prisma } from '@/lib/prisma';

export type FlightScheduleTermsErrorCode = 'NOT_FOUND' | 'NO_CHANGES' | 'REQUEST_REUSED';

export class FlightScheduleTermsError extends Error {
    constructor(
        readonly code: FlightScheduleTermsErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'FlightScheduleTermsError';
    }
}

export interface FlightScheduleTermsInput {
    requestId: string;
    flightScheduleId: number;
    actorUserId: string;
    durationMinutes: number;
    priceCents: number;
}

export interface FlightScheduleTermsResult {
    changeId: string;
    flightScheduleId: number;
    durationMinutes: number;
    priceCents: number;
    updatedOccurrenceCount: number;
    protectedOccurrenceCount: number;
    createdAt: Date;
    wasApplied: boolean;
}

type StoredChange = {
    id: string;
    requestId: string;
    flightScheduleId: number;
    actorUserId: string | null;
    toDurationMinutes: number;
    toPriceCents: number;
    updatedOccurrenceCount: number;
    protectedOccurrenceCount: number;
    createdAt: Date;
};

export class FlightScheduleTermsService {
    async update(input: FlightScheduleTermsInput): Promise<FlightScheduleTermsResult> {
        try {
            return await prisma.$transaction(tx => this.updateInTransaction(tx, input));
        } catch (error) {
            // Two different schedules do not share a row lock. If their callers
            // race on one request key, the unique index decides which request
            // owns it and the losing transaction rolls back completely.
            if (!isUniqueConflict(error)) throw error;

            const existing = await prisma.flightScheduleTermsChange.findUnique({
                where: { requestId: input.requestId },
            });
            if (!existing) throw error;
            return resultForExisting(existing, input);
        }
    }

    private async updateInTransaction(
        tx: Prisma.TransactionClient,
        input: FlightScheduleTermsInput,
    ): Promise<FlightScheduleTermsResult> {
        const existingBeforeLock = await tx.flightScheduleTermsChange.findUnique({
            where: { requestId: input.requestId },
        });
        if (existingBeforeLock) return resultForExisting(existingBeforeLock, input);

        // The schedule serialises edits and blocks generators from attaching a
        // new occurrence until the template and its existing inventory agree.
        const lockedSchedule = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id"
            FROM "FlightSchedule"
            WHERE "id" = ${input.flightScheduleId}
            FOR UPDATE
        `;
        if (lockedSchedule.length === 0) {
            throw new FlightScheduleTermsError('NOT_FOUND', 'This flight schedule no longer exists.');
        }

        // A same-schedule retry may have waited for the first request above.
        // Re-read after the lock so a committed result is returned, not applied.
        const existingAfterLock = await tx.flightScheduleTermsChange.findUnique({
            where: { requestId: input.requestId },
        });
        if (existingAfterLock) return resultForExisting(existingAfterLock, input);

        const schedule = await tx.flightSchedule.findUnique({
            where: { id: input.flightScheduleId },
            select: { id: true, durationMinutes: true, priceCents: true },
        });
        if (!schedule) {
            throw new FlightScheduleTermsError('NOT_FOUND', 'This flight schedule no longer exists.');
        }
        if (
            schedule.durationMinutes === input.durationMinutes
            && schedule.priceCents === input.priceCents
        ) {
            throw new FlightScheduleTermsError(
                'NO_CHANGES',
                'Change the duration or fare before updating this schedule.',
            );
        }

        // Ascending IDs give every edit the same lock order. These row locks
        // also make a concurrent booking, hold or status change wait; the
        // classification query below therefore sees the winner's committed
        // state instead of silently overwriting a newly protected occurrence.
        await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id"
            FROM "Flight"
            WHERE "flightScheduleId" = ${input.flightScheduleId}
            ORDER BY "id"
            FOR UPDATE
        `;
        const clock = await tx.$queryRaw<Array<{ now: Date }>>`
            SELECT statement_timestamp() AS "now"
        `;
        if (!clock[0]) throw new Error('Could not establish the schedule update time.');
        const asOf = clock[0].now;

        const occurrences = await tx.flight.findMany({
            where: { flightScheduleId: input.flightScheduleId },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                departureDate: true,
                status: true,
                itineraryLegs: { select: { bookingId: true } },
                seatHolds: {
                    where: { expiresAt: { gt: asOf } },
                    select: { id: true },
                    take: 1,
                },
            },
        });
        const safeIds = occurrences
            .filter(occurrence => classifyScheduleOccurrence({
                departureDate: occurrence.departureDate,
                status: occurrence.status,
                bookingIds: occurrence.itineraryLegs.map(leg => leg.bookingId),
                hasActiveCheckout: occurrence.seatHolds.length > 0,
            }, asOf) === 'SAFE_FUTURE')
            .map(occurrence => occurrence.id);

        await tx.flightSchedule.update({
            where: { id: input.flightScheduleId },
            data: {
                durationMinutes: input.durationMinutes,
                priceCents: input.priceCents,
            },
        });
        if (safeIds.length > 0) {
            const updated = await tx.flight.updateMany({
                where: { id: { in: safeIds } },
                data: {
                    durationMinutes: input.durationMinutes,
                    priceCents: input.priceCents,
                },
            });
            if (updated.count !== safeIds.length) {
                throw new Error('The safe schedule occurrence set changed during the update.');
            }
        }

        const change = await tx.flightScheduleTermsChange.create({
            data: {
                requestId: input.requestId,
                flightScheduleId: input.flightScheduleId,
                actorUserId: input.actorUserId,
                fromDurationMinutes: schedule.durationMinutes,
                toDurationMinutes: input.durationMinutes,
                fromPriceCents: schedule.priceCents,
                toPriceCents: input.priceCents,
                updatedOccurrenceCount: safeIds.length,
                protectedOccurrenceCount: occurrences.length - safeIds.length,
            },
        });
        return resultFromChange(change, true);
    }
}

function resultForExisting(
    change: StoredChange,
    input: FlightScheduleTermsInput,
): FlightScheduleTermsResult {
    if (
        change.requestId !== input.requestId
        || change.flightScheduleId !== input.flightScheduleId
        || change.actorUserId !== input.actorUserId
        || change.toDurationMinutes !== input.durationMinutes
        || change.toPriceCents !== input.priceCents
    ) {
        throw new FlightScheduleTermsError(
            'REQUEST_REUSED',
            'This retry key belongs to a different schedule update. Start a new update.',
        );
    }
    return resultFromChange(change, false);
}

function resultFromChange(change: StoredChange, wasApplied: boolean): FlightScheduleTermsResult {
    return {
        changeId: change.id,
        flightScheduleId: change.flightScheduleId,
        durationMinutes: change.toDurationMinutes,
        priceCents: change.toPriceCents,
        updatedOccurrenceCount: change.updatedOccurrenceCount,
        protectedOccurrenceCount: change.protectedOccurrenceCount,
        createdAt: change.createdAt,
        wasApplied,
    };
}

function isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}
