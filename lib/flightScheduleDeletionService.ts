import { Prisma } from '@prisma/client';
import { classifyScheduleOccurrence } from './flightScheduleImpact';
import { withFlightScheduleGenerationLock } from './flightScheduleGenerationLock';
import { prisma } from './prisma';

export type FlightScheduleDeletionErrorCode = 'NOT_FOUND' | 'ACTIVE' | 'REQUEST_REUSED';

export class FlightScheduleDeletionError extends Error {
    constructor(readonly code: FlightScheduleDeletionErrorCode, message: string) {
        super(message);
        this.name = 'FlightScheduleDeletionError';
    }
}

export interface FlightScheduleDeletionInput {
    requestId: string;
    flightScheduleId: number;
    actorUserId: string;
}

export interface FlightScheduleDeletionResult {
    deletionId: string;
    flightScheduleId: number;
    occurrenceCount: number;
    protectedOccurrenceCount: number;
    deletedAt: Date;
    wasDeleted: boolean;
}

type StoredDeletion = {
    id: string;
    requestId: string;
    flightScheduleId: number;
    actorUserId: string | null;
    occurrenceCount: number;
    protectedOccurrenceCount: number;
    deletedAt: Date;
};

export class FlightScheduleDeletionService {
    async delete(input: FlightScheduleDeletionInput): Promise<FlightScheduleDeletionResult> {
        try {
            return await withFlightScheduleGenerationLock(
                input.flightScheduleId,
                tx => this.deleteInTransaction(tx, input),
            );
        } catch (error) {
            if (!isUniqueConflict(error)) throw error;
            const existing = await prisma.flightScheduleDeletion.findUnique({
                where: { requestId: input.requestId },
            });
            if (!existing) throw error;
            return resultForExisting(existing, input);
        }
    }

    private async deleteInTransaction(
        tx: Prisma.TransactionClient,
        input: FlightScheduleDeletionInput,
    ): Promise<FlightScheduleDeletionResult> {
        const existing = await tx.flightScheduleDeletion.findUnique({
            where: { requestId: input.requestId },
        });
        if (existing) return resultForExisting(existing, input);

        const locked = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id" FROM "FlightSchedule"
            WHERE "id" = ${input.flightScheduleId}
            FOR UPDATE
        `;
        if (locked.length === 0) {
            throw new FlightScheduleDeletionError('NOT_FOUND', 'This flight schedule no longer exists.');
        }

        const schedule = await tx.flightSchedule.findUnique({
            where: { id: input.flightScheduleId },
        });
        if (!schedule) {
            throw new FlightScheduleDeletionError('NOT_FOUND', 'This flight schedule no longer exists.');
        }
        if (schedule.isActive) {
            throw new FlightScheduleDeletionError(
                'ACTIVE',
                'Deactivate this template before deleting it permanently.',
            );
        }

        await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id" FROM "Flight"
            WHERE "flightScheduleId" = ${input.flightScheduleId}
            ORDER BY "id" FOR UPDATE
        `;
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
            SELECT statement_timestamp() AS "now"
        `;
        if (!clock) throw new Error('Could not establish the schedule deletion time.');
        const occurrences = await tx.flight.findMany({
            where: { flightScheduleId: input.flightScheduleId },
            orderBy: { id: 'asc' },
            select: {
                departureDate: true,
                status: true,
                itineraryLegs: { select: { bookingId: true } },
                seatHolds: {
                    where: { expiresAt: { gt: clock.now } },
                    select: { id: true },
                    take: 1,
                },
            },
        });
        const protectedOccurrenceCount = occurrences.filter(occurrence =>
            classifyScheduleOccurrence({
                departureDate: occurrence.departureDate,
                status: occurrence.status,
                bookingIds: occurrence.itineraryLegs.map(leg => leg.bookingId),
                hasActiveCheckout: occurrence.seatHolds.length > 0,
            }, clock.now) !== 'SAFE_FUTURE').length;

        const deletion = await tx.flightScheduleDeletion.create({
            data: {
                requestId: input.requestId,
                flightScheduleId: schedule.id,
                actorUserId: input.actorUserId,
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
                occurrenceCount: occurrences.length,
                protectedOccurrenceCount,
            },
        });
        await tx.flightSchedule.delete({ where: { id: schedule.id } });
        return resultFromDeletion(deletion, true);
    }
}

function resultForExisting(
    deletion: StoredDeletion,
    input: FlightScheduleDeletionInput,
): FlightScheduleDeletionResult {
    if (
        deletion.requestId !== input.requestId
        || deletion.flightScheduleId !== input.flightScheduleId
        || deletion.actorUserId !== input.actorUserId
    ) {
        throw new FlightScheduleDeletionError(
            'REQUEST_REUSED',
            'This retry key belongs to a different schedule deletion. Start again.',
        );
    }
    return resultFromDeletion(deletion, false);
}

function resultFromDeletion(
    deletion: StoredDeletion,
    wasDeleted: boolean,
): FlightScheduleDeletionResult {
    return {
        deletionId: deletion.id,
        flightScheduleId: deletion.flightScheduleId,
        occurrenceCount: deletion.occurrenceCount,
        protectedOccurrenceCount: deletion.protectedOccurrenceCount,
        deletedAt: deletion.deletedAt,
        wasDeleted,
    };
}

function isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}
