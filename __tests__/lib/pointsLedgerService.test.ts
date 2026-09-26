/** @jest-environment node */

import {
    calculatePointsAccrualForFare,
    WELCOME_POINTS_NEW_USER,
    WELCOME_POINTS_DEV_USER,
    POINTS_EARN_MULTIPLIER_PER_DOLLAR,
    InsufficientPointsError,
    getUserSpendablePointsBalance,
    createPointsLedgerEntry,
    grantWelcomePointsIfEligible,
    accruePointsForCashBooking,
    getPointsLedgerHistory,
} from '@/lib/pointsLedgerService';
import { PointsTransactionType } from '@prisma/client';

describe('pointsLedgerService', () => {
    describe('points accrual calculation', () => {
        it('calculates 5x points per dollar spent on cash airfare', () => {
            // $250.00 ticket = 25,000 cents -> 1,250 points
            expect(calculatePointsAccrualForFare(25000)).toBe(1250);
            // $99.99 ticket = 9,999 cents -> 495 points (floored to whole dollar)
            expect(calculatePointsAccrualForFare(9999)).toBe(495);
            // $0 ticket = 0 points
            expect(calculatePointsAccrualForFare(0)).toBe(0);
            // Negative fare returns 0
            expect(calculatePointsAccrualForFare(-5000)).toBe(0);
        });

        it('defensively handles NaN and non-finite numbers', () => {
            expect(calculatePointsAccrualForFare(NaN)).toBe(0);
            expect(calculatePointsAccrualForFare(Infinity)).toBe(0);
            expect(calculatePointsAccrualForFare(-Infinity)).toBe(0);
        });
    });

    describe('constants', () => {
        it('exports expected welcome grant and earn multiplier constants', () => {
            expect(WELCOME_POINTS_NEW_USER).toBe(10000);
            expect(WELCOME_POINTS_DEV_USER).toBe(50000);
            expect(POINTS_EARN_MULTIPLIER_PER_DOLLAR).toBe(5);
        });
    });

    describe('InsufficientPointsError', () => {
        it('creates InsufficientPointsError carrying required and available points', () => {
            const error = new InsufficientPointsError(15000, 10000);
            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('InsufficientPointsError');
            expect(error.required).toBe(15000);
            expect(error.available).toBe(10000);
            expect(error.message).toContain('15000 required, 10000 available');
        });
    });

    describe('getUserSpendablePointsBalance', () => {
        it('returns running balance from latest PointsLedgerEntry', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue({ balanceAfter: 35000 }),
                },
            };
            const balance = await getUserSpendablePointsBalance('user-1', mockTx);
            expect(balance).toBe(35000);
            expect(mockTx.pointsLedgerEntry.findFirst).toHaveBeenCalledWith({
                where: { userId: 'user-1' },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: { balanceAfter: true },
            });
        });

        it('returns 0 when user has no ledger entries', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue(null),
                },
            };
            const balance = await getUserSpendablePointsBalance('user-empty', mockTx);
            expect(balance).toBe(0);
        });
    });

    describe('createPointsLedgerEntry', () => {
        it('throws InsufficientPointsError when debit causes negative balance', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue({ balanceAfter: 5000 }),
                    create: jest.fn(),
                },
            };
            await expect(
                createPointsLedgerEntry(
                    {
                        userId: 'user-1',
                        type: PointsTransactionType.REWARD_REDEMPTION,
                        amount: -15000,
                        description: 'Redemption for flight',
                    },
                    mockTx
                )
            ).rejects.toThrow(InsufficientPointsError);
            expect(mockTx.pointsLedgerEntry.create).not.toHaveBeenCalled();
        });

        it('calculates balanceAfter and creates ledger entry when balance is sufficient', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue({ balanceAfter: 20000 }),
                    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'entry-1', ...data })),
                },
            };
            const entry = await createPointsLedgerEntry(
                {
                    userId: 'user-1',
                    type: PointsTransactionType.REWARD_REDEMPTION,
                    amount: -15000,
                    description: 'Redemption for flight',
                    bookingId: 123,
                },
                mockTx
            );
            expect(entry.balanceAfter).toBe(5000);
            expect(mockTx.pointsLedgerEntry.create).toHaveBeenCalledWith({
                data: {
                    userId: 'user-1',
                    type: PointsTransactionType.REWARD_REDEMPTION,
                    amount: -15000,
                    balanceAfter: 5000,
                    description: 'Redemption for flight',
                    bookingId: 123,
                },
            });
        });
    });

    describe('grantWelcomePointsIfEligible', () => {
        const originalDevEmails = process.env.DEV_LOYALTY_EMAILS;

        afterEach(() => {
            process.env.DEV_LOYALTY_EMAILS = originalDevEmails;
        });

        it('grants standard welcome points (10000) for regular users and does not falsely match substring emails', async () => {
            process.env.DEV_LOYALTY_EMAILS = 'developer@mona.internal,lead-dev@mona.internal';
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'entry-welcome', ...data })),
                },
                user: {
                    findUnique: jest.fn().mockResolvedValue({ role: 'USER', email: 'devon.smith@example.com' }),
                },
            };
            const granted = await grantWelcomePointsIfEligible('user-devon', undefined, mockTx);
            expect(granted).toBe(10000);
            expect(mockTx.pointsLedgerEntry.create).toHaveBeenCalledWith({
                data: {
                    userId: 'user-devon',
                    type: PointsTransactionType.WELCOME_GRANT,
                    amount: 10000,
                    balanceAfter: 10000,
                    description: 'Welcome grant',
                    bookingId: null,
                },
            });
        });

        it('grants dev welcome points (50000) for ADMIN role or exact DEV_LOYALTY_EMAILS matches', async () => {
            process.env.DEV_LOYALTY_EMAILS = 'special-tester@example.com';
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'entry-welcome-dev', ...data })),
                },
                user: {
                    findUnique: jest.fn().mockResolvedValue({ role: 'USER', email: 'special-tester@example.com' }),
                },
            };
            const granted = await grantWelcomePointsIfEligible('user-tester', undefined, mockTx);
            expect(granted).toBe(50000);
            expect(mockTx.pointsLedgerEntry.create).toHaveBeenCalledWith({
                data: {
                    userId: 'user-tester',
                    type: PointsTransactionType.WELCOME_GRANT,
                    amount: 50000,
                    balanceAfter: 50000,
                    description: 'Welcome grant (development account)',
                    bookingId: null,
                },
            });
        });

        it('grants custom points when explicitly passed as number', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'entry-welcome-custom', ...data })),
                },
            };
            const granted = await grantWelcomePointsIfEligible('user-custom', 25000, mockTx);
            expect(granted).toBe(25000);
            expect(mockTx.pointsLedgerEntry.create).toHaveBeenCalledWith({
                data: {
                    userId: 'user-custom',
                    type: PointsTransactionType.WELCOME_GRANT,
                    amount: 25000,
                    balanceAfter: 25000,
                    description: 'Welcome grant',
                    bookingId: null,
                },
            });
        });

        it('returns 0 if user already has an existing ledger entry', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue({ id: 'existing', balanceAfter: 10000 }),
                    create: jest.fn(),
                },
            };
            const granted = await grantWelcomePointsIfEligible('user-existing', undefined, mockTx);
            expect(granted).toBe(0);
            expect(mockTx.pointsLedgerEntry.create).not.toHaveBeenCalled();
        });
    });

    describe('accruePointsForCashBooking', () => {
        it('accrues 5x points for valid cash booking and creates FLIGHT_EARN ledger entry', async () => {
            const mockBooking = {
                id: 456,
                reference: 'BK-789',
                userId: 'user-1',
                totalPriceCents: 45000, // $450 -> 2,250 points
                isRewardBooking: false,
            };
            const mockTx: any = {
                booking: {
                    findUnique: jest.fn().mockResolvedValue(mockBooking),
                },
                pointsLedgerEntry: {
                    findFirst: jest
                        .fn()
                        // 1st call: check existing FLIGHT_EARN -> null
                        .mockResolvedValueOnce(null)
                        // 2nd call: getUserSpendablePointsBalance -> 10,000
                        .mockResolvedValueOnce({ balanceAfter: 10000 }),
                    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'entry-earn', ...data })),
                },
            };

            const points = await accruePointsForCashBooking(456, mockTx);
            expect(points).toBe(2250);
            expect(mockTx.pointsLedgerEntry.create).toHaveBeenCalledWith({
                data: {
                    userId: 'user-1',
                    type: PointsTransactionType.FLIGHT_EARN,
                    amount: 2250,
                    balanceAfter: 12250,
                    description: 'Points earned for flight booking #BK-789',
                    bookingId: 456,
                },
            });
        });

        it('does not accrue points if booking is a reward booking', async () => {
            const mockBooking = {
                id: 457,
                reference: 'BK-RW1',
                userId: 'user-1',
                totalPriceCents: 1010, // $10.10 taxes
                isRewardBooking: true,
            };
            const mockTx: any = {
                booking: {
                    findUnique: jest.fn().mockResolvedValue(mockBooking),
                },
                pointsLedgerEntry: {
                    create: jest.fn(),
                },
            };

            const points = await accruePointsForCashBooking(457, mockTx);
            expect(points).toBe(0);
            expect(mockTx.pointsLedgerEntry.create).not.toHaveBeenCalled();
        });

        it('does not double accrue points if FLIGHT_EARN already exists for booking', async () => {
            const mockBooking = {
                id: 458,
                reference: 'BK-ALREADY',
                userId: 'user-1',
                totalPriceCents: 50000,
                isRewardBooking: false,
            };
            const mockTx: any = {
                booking: {
                    findUnique: jest.fn().mockResolvedValue(mockBooking),
                },
                pointsLedgerEntry: {
                    findFirst: jest.fn().mockResolvedValue({ id: 'prior-earn', amount: 2500 }),
                    create: jest.fn(),
                },
            };

            const points = await accruePointsForCashBooking(458, mockTx);
            expect(points).toBe(0);
            expect(mockTx.pointsLedgerEntry.create).not.toHaveBeenCalled();
        });

        it('throws error if booking is not found', async () => {
            const mockTx: any = {
                booking: {
                    findUnique: jest.fn().mockResolvedValue(null),
                },
            };
            await expect(accruePointsForCashBooking(9999, mockTx)).rejects.toThrow('Booking not found: 9999');
        });
    });

    describe('getPointsLedgerHistory', () => {
        it('returns paginated ledger entries with total count and page metadata', async () => {
            const mockEntries = [
                { id: 'entry-2', amount: 500, balanceAfter: 10500, createdAt: new Date() },
                { id: 'entry-1', amount: 10000, balanceAfter: 10000, createdAt: new Date() },
            ];
            const mockTx: any = {
                pointsLedgerEntry: {
                    findMany: jest.fn().mockResolvedValue(mockEntries),
                    count: jest.fn().mockResolvedValue(2),
                },
            };
            const history = await getPointsLedgerHistory('user-1', { page: 1, pageSize: 10 }, mockTx);
            expect(history.entries).toEqual(mockEntries);
            expect(history.total).toBe(2);
            expect(history.totalCount).toBe(2);
            expect(history.page).toBe(1);
            expect(history.pageSize).toBe(10);
            expect(history.totalPages).toBe(1);
        });

        it('caps pageSize between 1 and 100', async () => {
            const mockTx: any = {
                pointsLedgerEntry: {
                    findMany: jest.fn().mockResolvedValue([]),
                    count: jest.fn().mockResolvedValue(0),
                },
            };
            const historyLarge = await getPointsLedgerHistory('user-1', { pageSize: 500 }, mockTx);
            expect(historyLarge.pageSize).toBe(100);

            const historySmall = await getPointsLedgerHistory('user-1', { pageSize: -10 }, mockTx);
            expect(historySmall.pageSize).toBe(1);
        });
    });
});
