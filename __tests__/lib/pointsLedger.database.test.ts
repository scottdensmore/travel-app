/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { PointsTransactionType } from '@prisma/client';
import {
    getUserSpendablePointsBalance,
    createPointsLedgerEntry,
    grantWelcomePointsIfEligible,
    accruePointsForCashBooking,
    getPointsLedgerHistory,
    InsufficientPointsError,
    WELCOME_POINTS_NEW_USER,
} from '@/lib/pointsLedgerService';

const created = {
    userIds: [] as string[],
    bookingIds: [] as number[],
};

async function createTestUser(role: 'USER' | 'ADMIN' = 'USER', emailPrefix = 'points-test') {
    const user = await prisma.user.create({
        data: {
            name: `Points Test User ${randomUUID().slice(0, 8)}`,
            email: `${emailPrefix}-${randomUUID()}@example.com`,
            password: 'not-used-in-tests',
            emailVerified: new Date(),
            role,
        },
    });
    created.userIds.push(user.id);
    return user;
}

afterAll(async () => {
    try {
        if (created.bookingIds.length > 0) {
            await prisma.pointsLedgerEntry.deleteMany({
                where: { bookingId: { in: created.bookingIds } },
            });
            await prisma.booking.deleteMany({
                where: { id: { in: created.bookingIds } },
            });
        }
        if (created.userIds.length > 0) {
            await prisma.pointsLedgerEntry.deleteMany({
                where: { userId: { in: created.userIds } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: created.userIds } },
            });
        }
    } finally {
        await prisma.$disconnect();
    }
});

describe('pointsLedger database integration', () => {
    it('persists ledger entries and maintains running spendable balance', async () => {
        const user = await createTestUser();

        // 1. Initial balance is 0
        const initialBalance = await getUserSpendablePointsBalance(user.id);
        expect(initialBalance).toBe(0);

        // 2. Grant points
        const entry1 = await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 10000,
            description: 'Welcome grant',
        });
        expect(entry1.balanceAfter).toBe(10000);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(10000);

        // 3. Accrue points
        const entry2 = await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.FLIGHT_EARN,
            amount: 2500,
            description: 'Flight earn',
        });
        expect(entry2.balanceAfter).toBe(12500);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(12500);

        // 4. Redeem points
        const entry3 = await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.REWARD_REDEMPTION,
            amount: -5000,
            description: 'Award flight redemption',
        });
        expect(entry3.balanceAfter).toBe(7500);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(7500);

        // 5. Verify database records
        const allEntries = await prisma.pointsLedgerEntry.findMany({
            where: { userId: user.id },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        expect(allEntries).toHaveLength(3);
        expect(allEntries[0].balanceAfter).toBe(10000);
        expect(allEntries[1].balanceAfter).toBe(12500);
        expect(allEntries[2].balanceAfter).toBe(7500);
    });

    it('enforces idempotency for welcome points grants', async () => {
        const user = await createTestUser();

        // First grant: should succeed and award welcome points
        const granted1 = await grantWelcomePointsIfEligible(user.id);
        expect(granted1).toBe(WELCOME_POINTS_NEW_USER);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(WELCOME_POINTS_NEW_USER);

        // Second grant attempt: user already has ledger entries, should award 0
        const granted2 = await grantWelcomePointsIfEligible(user.id);
        expect(granted2).toBe(0);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(WELCOME_POINTS_NEW_USER);

        const count = await prisma.pointsLedgerEntry.count({
            where: { userId: user.id },
        });
        expect(count).toBe(1);
    });

    it('rolls back database transaction and preserves balance on insufficient points', async () => {
        const user = await createTestUser();

        // Give user 5,000 points
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 5000,
            description: 'Initial grant',
        });
        expect(await getUserSpendablePointsBalance(user.id)).toBe(5000);

        // Attempt transaction with debit of 15,000 points (shortfall of 10,000)
        let caughtError: unknown;
        try {
            await prisma.$transaction(async (tx) => {
                await createPointsLedgerEntry(
                    {
                        userId: user.id,
                        type: PointsTransactionType.REWARD_REDEMPTION,
                        amount: -15000,
                        description: 'Overdrawing debit',
                    },
                    tx
                );
            });
        } catch (err) {
            caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(InsufficientPointsError);
        const insufficientErr = caughtError as InsufficientPointsError;
        expect(insufficientErr.required).toBe(15000);
        expect(insufficientErr.available).toBe(5000);

        // Verify balance and entry count are unchanged
        expect(await getUserSpendablePointsBalance(user.id)).toBe(5000);
        const entriesAfterRollback = await prisma.pointsLedgerEntry.findMany({
            where: { userId: user.id },
        });
        expect(entriesAfterRollback).toHaveLength(1);
        expect(entriesAfterRollback[0].type).toBe(PointsTransactionType.WELCOME_GRANT);
    });

    it('accrues 5x points for cash booking and prevents duplicate accrual', async () => {
        const user = await createTestUser();

        // Create booking with totalPriceCents = 40,000 ($400.00 -> 2,000 points)
        const booking = await prisma.booking.create({
            data: {
                userId: user.id,
                totalPriceCents: 40000,
                currency: 'USD',
                status: 'CONFIRMED',
                isRewardBooking: false,
            },
        });
        created.bookingIds.push(booking.id);

        // 1. Accrue points for cash booking
        const accruedPoints = await accruePointsForCashBooking(booking.id);
        expect(accruedPoints).toBe(2000);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(2000);

        const entry = await prisma.pointsLedgerEntry.findFirst({
            where: { bookingId: booking.id, type: PointsTransactionType.FLIGHT_EARN },
        });
        expect(entry).not.toBeNull();
        expect(entry?.amount).toBe(2000);
        expect(entry?.bookingId).toBe(booking.id);

        // 2. Second attempt: duplicate accrual should be blocked and return 0
        const secondAttempt = await accruePointsForCashBooking(booking.id);
        expect(secondAttempt).toBe(0);
        expect(await getUserSpendablePointsBalance(user.id)).toBe(2000);

        const count = await prisma.pointsLedgerEntry.count({
            where: { bookingId: booking.id },
        });
        expect(count).toBe(1);
    });

    it('fetches paginated ledger history with total count and page metadata', async () => {
        const user = await createTestUser();

        // Create 3 entries
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 10000,
            description: 'Entry 1',
        });
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.FLIGHT_EARN,
            amount: 1000,
            description: 'Entry 2',
        });
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.FLIGHT_EARN,
            amount: 500,
            description: 'Entry 3',
        });

        // Page 1 with pageSize = 2
        const page1 = await getPointsLedgerHistory(user.id, { page: 1, pageSize: 2 });
        expect(page1.entries).toHaveLength(2);
        expect(page1.total).toBe(3);
        expect(page1.totalCount).toBe(3);
        expect(page1.page).toBe(1);
        expect(page1.pageSize).toBe(2);
        expect(page1.totalPages).toBe(2);
        expect(page1.entries[0].description).toBe('Entry 3'); // Most recent first
        expect(page1.entries[1].description).toBe('Entry 2');

        // Page 2 with pageSize = 2
        const page2 = await getPointsLedgerHistory(user.id, { page: 2, pageSize: 2 });
        expect(page2.entries).toHaveLength(1);
        expect(page2.total).toBe(3);
        expect(page2.page).toBe(2);
        expect(page2.entries[0].description).toBe('Entry 1');
    });
});
