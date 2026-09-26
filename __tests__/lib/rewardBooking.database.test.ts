/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import FlightBookingService from '@/lib/FlightBookingService';
import { airportCodesForRoute } from '@/lib/airports';
import { checkoutHolderKey, holdSeats } from '@/lib/seatHolds';
import { prisma } from '@/lib/prisma';
import { PointsTransactionType } from '@prisma/client';
import {
    getUserSpendablePointsBalance,
    createPointsLedgerEntry,
    InsufficientPointsError,
} from '@/lib/pointsLedgerService';
import { CheckoutPaymentService } from '@/lib/checkoutPaymentService';
import type { PaymentProvider } from '@/lib/stripePaymentProvider';

const created = {
    flightIds: [] as number[],
    userIds: [] as string[],
    bookingIds: [] as number[],
};

async function createTestUser(emailPrefix = 'reward-user') {
    const user = await prisma.user.create({
        data: {
            name: `Reward User ${randomUUID().slice(0, 8)}`,
            email: `${emailPrefix}-${randomUUID()}@example.com`,
            password: 'not-used-in-tests',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);
    return user;
}

async function createTestFlight(options?: {
    from?: string;
    to?: string;
    priceCents?: number;
    awardSeatsEconomy?: number;
    awardSeatsBusiness?: number;
}) {
    const suffix = randomUUID();
    const fromLabel = options?.from ?? 'Seattle, USA';
    const toLabel = options?.to ?? 'Detroit, USA';
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RWD-${suffix.slice(0, 8)}`,
            airline: 'Aero Reward',
            ...airportCodesForRoute(fromLabel, toLabel),
            departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            priceCents: options?.priceCents ?? 30_000,
            firstClassRows: 0,
            businessRows: 2,
            premiumEconomyRows: 2,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
            awardSeatsEconomy: options?.awardSeatsEconomy ?? 4,
            awardSeatsBusiness: options?.awardSeatsBusiness ?? 2,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function holdBookingSeats(flightId: number, seatNumbers: string[], idempotencyKey: string, userId: string) {
    const holderKey = checkoutHolderKey(userId, idempotencyKey);
    await holdSeats(seatNumbers.map(seatNumber => ({ flightId, seatNumber, holderKey })));
    return { holderKey, idempotencyKey };
}

function mockPaymentProvider(): PaymentProvider {
    return {
        createAuthorization: jest.fn().mockResolvedValue({
            providerIntentId: 'pi_reward_test',
            status: 'AUTHORIZED',
        }),
        retrieveAuthorization: jest.fn().mockResolvedValue({
            providerIntentId: 'pi_reward_test',
            status: 'AUTHORIZED',
            amountCents: 1010,
        }),
        captureAuthorization: jest.fn().mockResolvedValue({
            providerIntentId: 'pi_reward_test',
            status: 'CAPTURED',
            amountCents: 1010,
        }),
        cancelAuthorization: jest.fn().mockResolvedValue({
            providerIntentId: 'pi_reward_test',
            status: 'CANCELLED',
        }),
    };
}

afterAll(async () => {
    try {
        if (created.bookingIds.length > 0 || created.userIds.length > 0) {
            await prisma.pointsLedgerEntry.deleteMany({
                where: {
                    OR: [
                        { userId: { in: created.userIds } },
                        { bookingId: { in: created.bookingIds } },
                    ],
                },
            });
            await prisma.passengerAncillary.deleteMany({
                where: { passenger: { booking: { userId: { in: created.userIds } } } },
            });
            await prisma.seatAssignment.deleteMany({
                where: {
                    OR: [
                        { passenger: { booking: { userId: { in: created.userIds } } } },
                        { leg: { bookingId: { in: created.bookingIds } } },
                    ],
                },
            });
            await prisma.passenger.deleteMany({
                where: {
                    OR: [
                        { booking: { userId: { in: created.userIds } } },
                        { bookingId: { in: created.bookingIds } },
                    ],
                },
            });
            await prisma.booking.deleteMany({
                where: {
                    OR: [
                        { userId: { in: created.userIds } },
                        { id: { in: created.bookingIds } },
                    ],
                },
            });
            await prisma.itineraryLeg.deleteMany({
                where: {
                    OR: [
                        { flightId: { in: created.flightIds } },
                        { bookingId: { in: created.bookingIds } },
                    ],
                },
            });
        }
        if (created.flightIds.length > 0) {
            await prisma.seatHold.deleteMany({ where: { flightId: { in: created.flightIds } } });
            await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        }
        if (created.userIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
        }
    } finally {
        await prisma.$disconnect();
    }
});

describe('FlightBookingService reward redemption', () => {
    it('atomically debits user points, decrements award capacity, and records reward booking', async () => {
        // Setup user with 50,000 points and a flight with 4 award seats
        const user = await createTestUser();
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 50000,
            description: 'Initial grant',
        });

        const flight = await createTestFlight({ awardSeatsEconomy: 4 });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10A'], idempotencyKey, user.id);

        // Call bookFlight with isRewardBooking: true
        const booking = await FlightBookingService.bookFlight({
            userId: user.id,
            flightIds: [flight.id],
            idempotencyKey,
            isRewardBooking: true,
            passengers: [{
                firstName: 'Alice',
                lastName: 'Smith',
                dateOfBirth: '1990-01-01',
                passportNumber: 'P12345678',
                gender: 'F',
                cabinClass: 'ECONOMY',
                seatNumbers: ['10A'],
            }],
        });
        created.bookingIds.push(booking.id);

        // Verify points balance is now 35,000 (50,000 - 15,000)
        const balance = await getUserSpendablePointsBalance(user.id);
        expect(balance).toBe(35000);

        // Verify flight awardSeatsEconomy is now 3
        const updatedFlight = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
        });
        expect(updatedFlight.awardSeatsEconomy).toBe(3);

        // Verify booking.isRewardBooking is true and pointsRedeemed is 15000
        expect(booking.isRewardBooking).toBe(true);
        expect(booking.pointsRedeemed).toBe(15000);
        // Cash total should be mandatory taxes (1010 cents)
        expect(booking.totalPriceCents).toBe(1010);

        // Verify ledger entry linked to booking
        const ledgerEntry = await prisma.pointsLedgerEntry.findFirst({
            where: { bookingId: booking.id, type: PointsTransactionType.REWARD_REDEMPTION },
        });
        expect(ledgerEntry).not.toBeNull();
        expect(ledgerEntry?.amount).toBe(-15000);
        expect(ledgerEntry?.balanceAfter).toBe(35000);
    });

    it('rejects booking when user has insufficient points without modifying inventory', async () => {
        // Setup user with only 5,000 points
        const user = await createTestUser();
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 5000,
            description: 'Low balance grant',
        });

        const flight = await createTestFlight({ awardSeatsEconomy: 4 });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10A'], idempotencyKey, user.id);

        // Call bookFlight for 15,000 point flight
        await expect(FlightBookingService.bookFlight({
            userId: user.id,
            flightIds: [flight.id],
            idempotencyKey,
            isRewardBooking: true,
            passengers: [{
                firstName: 'Bob',
                lastName: 'Jones',
                dateOfBirth: '1988-02-02',
                passportNumber: 'P87654321',
                gender: 'M',
                cabinClass: 'ECONOMY',
                seatNumbers: ['10A'],
            }],
        })).rejects.toThrow(InsufficientPointsError);

        // Verify flight awardSeatsEconomy is unchanged
        const flightAfter = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
        });
        expect(flightAfter.awardSeatsEconomy).toBe(4);

        // Verify user points balance is unchanged
        const balance = await getUserSpendablePointsBalance(user.id);
        expect(balance).toBe(5000);

        // Verify no booking was created
        const bookingCount = await prisma.booking.count({
            where: { userId: user.id },
        });
        expect(bookingCount).toBe(0);
    });

    it('rejects booking when award seats are exhausted for the requested cabin', async () => {
        const user = await createTestUser();
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 50000,
            description: 'Sufficient balance',
        });

        const flight = await createTestFlight({ awardSeatsEconomy: 0 });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10A'], idempotencyKey, user.id);

        await expect(FlightBookingService.bookFlight({
            userId: user.id,
            flightIds: [flight.id],
            idempotencyKey,
            isRewardBooking: true,
            passengers: [{
                firstName: 'Carol',
                lastName: 'White',
                dateOfBirth: '1992-03-03',
                passportNumber: 'P11223344',
                gender: 'F',
                cabinClass: 'ECONOMY',
                seatNumbers: ['10A'],
            }],
        })).rejects.toThrow(/award seat/i);

        // Verify user balance is unchanged
        const balance = await getUserSpendablePointsBalance(user.id);
        expect(balance).toBe(50000);

        // Verify inventory unchanged
        const flightAfter = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
        });
        expect(flightAfter.awardSeatsEconomy).toBe(0);
    });

    it('atomically handles multi-passenger reward booking with ancillaries and mixed cabins', async () => {
        const user = await createTestUser();
        await createPointsLedgerEntry({
            userId: user.id,
            type: PointsTransactionType.WELCOME_GRANT,
            amount: 60000,
            description: 'Large grant',
        });

        const flight = await createTestFlight({ awardSeatsEconomy: 4, awardSeatsBusiness: 2 });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10A', '1A'], idempotencyKey, user.id);

        const booking = await FlightBookingService.bookFlight({
            userId: user.id,
            flightIds: [flight.id],
            idempotencyKey,
            isRewardBooking: true,
            passengers: [
                {
                    firstName: 'Dave',
                    lastName: 'Miller',
                    dateOfBirth: '1980-04-04',
                    passportNumber: 'P55667788',
                    gender: 'M',
                    cabinClass: 'ECONOMY',
                    seatNumbers: ['10A'],
                },
                {
                    firstName: 'Eve',
                    lastName: 'Miller',
                    dateOfBirth: '1982-05-05',
                    passportNumber: 'P99887766',
                    gender: 'F',
                    cabinClass: 'BUSINESS',
                    seatNumbers: ['1A'],
                },
            ],
            ancillariesByPassenger: {
                0: ['CHECKED_BAG_1'], // 3500 cents
            },
        });
        created.bookingIds.push(booking.id);

        // Economy = 15,000 pts, Business = 40,000 pts -> 55,000 pts total
        // Taxes = 2 * 1010 = 2020 cents
        // Ancillaries = 3500 cents
        // Total cash = 5520 cents
        expect(booking.isRewardBooking).toBe(true);
        expect(booking.pointsRedeemed).toBe(55000);
        expect(booking.totalPriceCents).toBe(5520);

        // Balance: 60,000 - 55,000 = 5,000
        expect(await getUserSpendablePointsBalance(user.id)).toBe(5000);

        // Award seats decremented
        const updatedFlight = await prisma.flight.findUniqueOrThrow({
            where: { id: flight.id },
        });
        expect(updatedFlight.awardSeatsEconomy).toBe(3);
        expect(updatedFlight.awardSeatsBusiness).toBe(1);
    });

    it('rejects payment authorization when award seats are exhausted for the requested cabin', async () => {
        const user = await createTestUser();
        const flight = await createTestFlight({ awardSeatsEconomy: 0 });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10A'], idempotencyKey, user.id);

        const paymentService = new CheckoutPaymentService(mockPaymentProvider());
        await expect(paymentService.startPayment({
            userId: user.id,
            checkoutId: idempotencyKey,
            flightIds: [flight.id],
            passengers: [{
                seatNumbers: ['10A'],
                cabinClass: 'ECONOMY',
            }],
            isRewardBooking: true,
        })).rejects.toThrow(/Insufficient award seats/i);
    });
});
