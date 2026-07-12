import type { Prisma } from '@prisma/client';

type FlightLockClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

export async function lockFlightForUpdate(tx: FlightLockClient, flightId: number): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Flight" WHERE "id" = ${flightId} FOR UPDATE`;
}
