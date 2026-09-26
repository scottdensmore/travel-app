/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { cancelBookingAction } from '@/app/actions';
import { getServerSession } from 'next-auth';
import { PointsTransactionType } from '@prisma/client';
import {
    getUserSpendablePointsBalance,
    createPointsLedgerEntry,
} from '@/lib/pointsLedgerService';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/stripePaymentProvider', () => ({
    createStripePaymentProvider: jest.fn().mockReturnValue({}),
    getStripePublishableKey: jest.fn().mockReturnValue('pk_test_123'),
}));
jest.mock('@/lib/paymentRefundService', () => ({
    PaymentRefundService: jest.fn().mockImplementation(() => ({
        settleRefund: jest.fn().mockResolvedValue({ id: 'ref_test', status: 'SUCCEEDED' }),
    })),
}));

const mockedGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

const created = {
    flightIds: [] as number[],
    userIds: [] as string[],
    bookingIds: [] as number[],
};

async function createTestUser(emailPrefix = 'reward-cancel-user') {
    const user = await prisma.user.create({
        data: {
            name: `Reward Cancel User ${randomUUID().slice(0, 8)}`,
            email: `${emailPrefix}-${randomUUID()}@example.com`,
            password: 'not-used-in-tests',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);
    return user;
}

async function createTestFlight(options?: {
    awardSeatsEconomy?: number;
    awardSeatsBusiness?: number;
    departsInHours?: number;
}) {
    const suffix = randomUUID().slice(0, 8);
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RC-${suffix}`,
            airline: 'Reward Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + (options?.departsInHours ?? 48) * 60 * 60 * 1000),
            priceCents: 30000,
            firstClassRows: 0,
            businessRows: 2,
            premiumEconomyRows: 2,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
            awardSeatsEconomy: options?.awardSeatsEconomy ?? 3,
            awardSeatsBusiness: options?.awardSeatsBusiness ?? 1,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function createRewardBooking(options: {
    userId: string;
    flightId: number;
    cabinClass: 'ECONOMY' | 'BUSINESS';
    pointsRedeemed: number;
    totalPriceCents: number;
    seatNumber?: string;
}) {
    const booking = await prisma.booking.create({
        data: {
            userId: options.userId,
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: options.pointsRedeemed,
            totalPriceCents: options.totalPriceCents,
            paymentIntentId: `pi_test_${randomUUID().slice(0, 10)}`,
            passengers: {
                create: [{
                    firstName: 'Alice',
                    lastName: 'CancelTest',
                    gender: 'Female',
                    sensitiveDataDeletedAt: new Date(),
                }],
            },
            legs: {
                create: [{
                    sequence: 1,
                    flightId: options.flightId,
                }],
            },
        },
        include: { legs: true, passengers: true },
    });
    created.bookingIds.push(booking.id);

    await prisma.seatAssignment.create({
        data: {
            passengerId: booking.passengers[0].id,
            legId: booking.legs[0].id,
            flightId: options.flightId,
            seatNumber: options.seatNumber ?? '1A',
            cabinClass: options.cabinClass,
        },
    });

    return booking;
}

afterAll(async () => {
    try {
        if (created.userIds.length > 0) {
            await prisma.notification.deleteMany({ where: { userId: { in: created.userIds } } });
            await prisma.pointsLedgerEntry.deleteMany({ where: { userId: { in: created.userIds } } });
            await prisma.booking.deleteMany({ where: { userId: { in: created.userIds } } });
        }
        if (created.flightIds.length > 0) {
            await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        }
        if (created.userIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
        }
    } finally {
        await prisma.$disconnect();
    }
});

describe('rewardCancellation database integration', () => {
    it('cancels Business reward booking with 100% points redeposit and replenishes award seats', async () => {
        const user = await createTestUser();
        // Give initial points
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 50000,
            description: 'Welcome grant',
        });

        const flight = await createTestFlight({ awardSeatsBusiness: 1, departsInHours: 48 });
        const booking = await createRewardBooking({
            userId: user.id,
            flightId: flight.id,
            cabinClass: 'BUSINESS',
            pointsRedeemed: 40000,
            totalPriceCents: 1010,
        });

        // Debit points for redemption
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.REWARD_REDEMPTION,
            amount: -40000,
            description: `Reward booking #${booking.id}`,
            bookingId: booking.id,
        });

        const balanceBefore = await getUserSpendablePointsBalance(user.id);
        expect(balanceBefore).toBe(10000);

        mockedGetServerSession.mockResolvedValue({
            user: { id: user.id, role: 'USER' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const cancelResult = await cancelBookingAction(booking.id);
        expect(cancelResult).toMatchObject({ id: booking.id, status: 'CANCELLED' });

        // Verify points redeposit in ledger
        const balanceAfter = await getUserSpendablePointsBalance(user.id);
        expect(balanceAfter).toBe(50000); // 10,000 + 40,000 (100% redeposit)

        const refundEntry = await prisma.pointsLedgerEntry.findFirst({
            where: {
                userId: user.id,
                bookingId: booking.id,
                type: PointsTransactionType.REWARD_REFUND,
            },
        });
        expect(refundEntry).not.toBeNull();
        expect(refundEntry?.amount).toBe(40000);
        expect(refundEntry?.balanceAfter).toBe(50000);

        // Verify award seat replenished
        const updatedFlight = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
            select: { awardSeatsBusiness: true },
        });
        expect(updatedFlight.awardSeatsBusiness).toBe(2); // 1 + 1

        // Verify card tax refund record created
        const refundRecord = await prisma.paymentRefund.findFirst({
            where: {
                providerIntentId: booking.paymentIntentId!,
            },
        });
        expect(refundRecord).not.toBeNull();
        expect(refundRecord?.amountCents).toBe(1010);
    });

    it('cancels Economy reward booking with 80% points redeposit and replenishes award seats', async () => {
        const user = await createTestUser();
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 50000,
            description: 'Welcome grant',
        });

        const flight = await createTestFlight({ awardSeatsEconomy: 3, departsInHours: 48 });
        const booking = await createRewardBooking({
            userId: user.id,
            flightId: flight.id,
            cabinClass: 'ECONOMY',
            pointsRedeemed: 15000,
            totalPriceCents: 1010,
        });

        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.REWARD_REDEMPTION,
            amount: -15000,
            description: `Reward booking #${booking.id}`,
            bookingId: booking.id,
        });

        mockedGetServerSession.mockResolvedValue({
            user: { id: user.id, role: 'USER' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await cancelBookingAction(booking.id);

        // 80% of 15,000 = 12,000 points redeposited
        const refundEntry = await prisma.pointsLedgerEntry.findFirst({
            where: {
                userId: user.id,
                bookingId: booking.id,
                type: PointsTransactionType.REWARD_REFUND,
            },
        });
        expect(refundEntry).not.toBeNull();
        expect(refundEntry?.amount).toBe(12000);

        const balanceAfter = await getUserSpendablePointsBalance(user.id);
        expect(balanceAfter).toBe(47000); // 35,000 + 12,000

        // Verify award seat replenished
        const updatedFlight = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
            select: { awardSeatsEconomy: true },
        });
        expect(updatedFlight.awardSeatsEconomy).toBe(4); // 3 + 1
    });

    it('forfeits points and taxes when reward booking is cancelled inside 24h cutoff', async () => {
        const user = await createTestUser();
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 50000,
            description: 'Welcome grant',
        });

        const flight = await createTestFlight({ awardSeatsEconomy: 2, departsInHours: 12 });
        const booking = await createRewardBooking({
            userId: user.id,
            flightId: flight.id,
            cabinClass: 'ECONOMY',
            pointsRedeemed: 15000,
            totalPriceCents: 1010,
        });

        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.REWARD_REDEMPTION,
            amount: -15000,
            description: `Reward booking #${booking.id}`,
            bookingId: booking.id,
        });

        mockedGetServerSession.mockResolvedValue({
            user: { id: user.id, role: 'USER' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await cancelBookingAction(booking.id);

        // No refund ledger entry created
        const refundEntry = await prisma.pointsLedgerEntry.findFirst({
            where: {
                userId: user.id,
                bookingId: booking.id,
                type: PointsTransactionType.REWARD_REFUND,
            },
        });
        expect(refundEntry).toBeNull();

        const balanceAfter = await getUserSpendablePointsBalance(user.id);
        expect(balanceAfter).toBe(35000); // Unchanged

        // Award seat is still replenished
        const updatedFlight = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
            select: { awardSeatsEconomy: true },
        });
        expect(updatedFlight.awardSeatsEconomy).toBe(3); // 2 + 1
    });
});
