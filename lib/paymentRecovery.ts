import type { PaymentAttemptStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { HOLD_MINUTES } from '@/lib/seatHolds';

export const PAYMENT_RECOVERY_LIMIT = 50;

export interface StalePaymentAttempt {
    id: string;
    checkoutId: string;
    providerIntentId: string;
    amountCents: number;
    currency: string;
    status: PaymentAttemptStatus;
    updatedAt: Date;
    userName: string | null;
    userEmail: string | null;
}

/**
 * Provider-backed attempts whose local state may have missed an update.
 *
 * Checkout owns the first ten minutes. The recovery queue starts only after
 * that long without a local payment update, and uses the database clock just
 * as the seat hold does. Captured and cancelled attempts are terminal and
 * cannot need this operation.
 */
export async function listStalePaymentAttempts(): Promise<StalePaymentAttempt[]> {
    return prisma.$queryRaw<StalePaymentAttempt[]>`
        SELECT
            attempt."id",
            attempt."checkoutId",
            attempt."providerIntentId",
            attempt."amountCents",
            attempt."currency",
            attempt."status",
            attempt."updatedAt",
            customer."name" AS "userName",
            customer."email" AS "userEmail"
        FROM "PaymentAttempt" AS attempt
        LEFT JOIN "User" AS customer ON customer."id" = attempt."userId"
        WHERE attempt."providerIntentId" IS NOT NULL
          AND attempt."status" NOT IN ('CAPTURED', 'CANCELLED')
          AND attempt."updatedAt" <= statement_timestamp()
              - make_interval(mins => ${HOLD_MINUTES}::int)
        ORDER BY attempt."updatedAt" ASC, attempt."id" ASC
        LIMIT ${PAYMENT_RECOVERY_LIMIT}
    `;
}
