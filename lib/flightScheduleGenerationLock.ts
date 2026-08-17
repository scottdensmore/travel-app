import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// A fixed namespace keeps this lock independent from other application
// advisory locks while the schedule id identifies the one template whose
// generation state is being read or changed.
const GENERATION_STATE_LOCK_NAMESPACE = 834_206;
const GENERATION_STATE_TRANSACTION_TIMEOUT_MS = 60_000;

export async function lockFlightScheduleGenerationState(
    tx: Prisma.TransactionClient,
    flightScheduleId: number,
) {
    await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
            CAST(${GENERATION_STATE_LOCK_NAMESPACE} AS integer),
            CAST(${flightScheduleId} AS integer)
        )
    `;
}

export async function withFlightScheduleGenerationLock<T>(
    flightScheduleId: number,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
    return prisma.$transaction(
        async tx => {
            await lockFlightScheduleGenerationState(tx, flightScheduleId);
            return operation(tx);
        },
        { timeout: GENERATION_STATE_TRANSACTION_TIMEOUT_MS },
    );
}
