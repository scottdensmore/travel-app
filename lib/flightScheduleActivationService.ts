import { Prisma } from '@prisma/client';
import { withFlightScheduleGenerationLock } from '@/lib/flightScheduleGenerationLock';

export type FlightScheduleActivationErrorCode = 'NOT_FOUND';

export class FlightScheduleActivationError extends Error {
    constructor(
        readonly code: FlightScheduleActivationErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'FlightScheduleActivationError';
    }
}

export interface FlightScheduleActivationResult {
    flightScheduleId: number;
    isActive: boolean;
    changed: boolean;
    preservedOccurrenceCount: number;
}

export async function lockFlightScheduleForUpdate(
    tx: Prisma.TransactionClient,
    flightScheduleId: number,
): Promise<boolean> {
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id"
        FROM "FlightSchedule"
        WHERE "id" = ${flightScheduleId}
        FOR UPDATE
    `;
    return locked.length > 0;
}

export class FlightScheduleActivationService {
    async setActive(
        flightScheduleId: number,
        isActive: boolean,
    ): Promise<FlightScheduleActivationResult> {
        return withFlightScheduleGenerationLock(flightScheduleId, tx => this.setActiveInTransaction(
            tx,
            flightScheduleId,
            isActive,
        ));
    }

    private async setActiveInTransaction(
        tx: Prisma.TransactionClient,
        flightScheduleId: number,
        isActive: boolean,
    ): Promise<FlightScheduleActivationResult> {
        if (!await lockFlightScheduleForUpdate(tx, flightScheduleId)) {
            throw new FlightScheduleActivationError(
                'NOT_FOUND',
                'This flight schedule no longer exists.',
            );
        }

        const schedule = await tx.flightSchedule.findUnique({
            where: { id: flightScheduleId },
            select: { id: true, isActive: true },
        });
        if (!schedule) {
            throw new FlightScheduleActivationError(
                'NOT_FOUND',
                'This flight schedule no longer exists.',
            );
        }

        const preservedOccurrenceCount = await tx.flight.count({
            where: { flightScheduleId },
        });
        const changed = schedule.isActive !== isActive;
        if (changed) {
            await tx.flightSchedule.update({
                where: { id: flightScheduleId },
                data: { isActive },
            });
        }

        return {
            flightScheduleId,
            isActive,
            changed,
            preservedOccurrenceCount,
        };
    }
}
