/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import FlightBookingService from '@/lib/FlightBookingService';
import { airportCodesForRoute } from '@/lib/airports';
import { checkoutHolderKey, holdSeat } from '@/lib/seatHolds';
import { prisma } from '@/lib/prisma';

const created = {
    flightIds: [] as number[],
    userIds: [] as string[],
    bookingIds: [] as number[],
};

let testUser: { id: string; email: string | null };

async function createTestFlight(options?: { from?: string; to?: string; priceCents?: number }) {
    const suffix = randomUUID();
    const fromLabel = options?.from === 'SEA' ? 'Seattle, USA' : (options?.from ?? 'Seattle, USA');
    const toLabel = options?.to === 'DTW' ? 'Detroit, USA' : (options?.to ?? 'Detroit, USA');
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `ANC-${suffix.slice(0, 8)}`,
            airline: 'Aero Ancillary',
            ...airportCodesForRoute(fromLabel, toLabel),
            departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            priceCents: options?.priceCents ?? 30_000,
            firstClassRows: 0,
            businessRows: 2,
            premiumEconomyRows: 2,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function holdBookingSeats(flightId: number, seatNumbers: string[], idempotencyKey = randomUUID(), userId = testUser.id) {
    const holderKey = checkoutHolderKey(userId, idempotencyKey);
    for (const seatNumber of seatNumbers) {
        await holdSeat({ flightId, seatNumber, holderKey });
    }
    return { holderKey, idempotencyKey };
}

beforeAll(async () => {
    const suffix = randomUUID();
    testUser = await prisma.user.create({
        data: {
            name: 'Ancillary Tester',
            email: `ancillary-${suffix}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(testUser.id);
});

afterAll(async () => {
    await prisma.passengerAncillary.deleteMany({
        where: { passenger: { booking: { userId: { in: created.userIds } } } },
    });
    await prisma.seatAssignment.deleteMany({
        where: { passenger: { booking: { userId: { in: created.userIds } } } },
    });
    await prisma.seatHold.deleteMany({ where: { flightId: { in: created.flightIds } } });
    await prisma.passenger.deleteMany({
        where: { booking: { userId: { in: created.userIds } } },
    });
    await prisma.booking.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.itineraryLeg.deleteMany({
        where: { flightId: { in: created.flightIds } },
    });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('FlightBookingService Ancillaries Persistence', () => {
    it('persists passenger ancillaries in database during booking creation', async () => {
        const flight = await createTestFlight({ from: 'SEA', to: 'DTW' });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10A'], idempotencyKey);

        const booking = await FlightBookingService.bookFlight({
            userId: testUser.id,
            flightIds: [flight.id],
            idempotencyKey,
            passengers: [{
                firstName: 'Sarah',
                lastName: 'Connor',
                dateOfBirth: '1985-05-12',
                passportNumber: 'P98765432',
                gender: 'F',
                cabinClass: 'ECONOMY',
                seatNumbers: ['10A'],
            }],
            ancillariesByPassenger: {
                0: ['CARRY_ON', 'CHECKED_BAG_1', 'PRIORITY_BOARDING'],
            },
        });
        created.bookingIds.push(booking.id);

        const persistedPassenger = await prisma.passenger.findFirst({
            where: { bookingId: booking.id },
            include: { ancillaries: true },
        });

        expect(persistedPassenger?.ancillaries).toHaveLength(3);
        const types = persistedPassenger?.ancillaries.map(a => a.type);
        expect(types).toContain('CARRY_ON');
        expect(types).toContain('CHECKED_BAG_1');
        expect(types).toContain('PRIORITY_BOARDING');

        const bag1 = persistedPassenger?.ancillaries.find(a => a.type === 'CHECKED_BAG_1');
        expect(bag1?.priceCents).toBe(3500);

        const priority = persistedPassenger?.ancillaries.find(a => a.type === 'PRIORITY_BOARDING');
        expect(priority?.priceCents).toBe(1500);
    });

    it('findBookingById includes passenger ancillaries', async () => {
        const flight = await createTestFlight({ from: 'SEA', to: 'DTW' });
        const idempotencyKey = randomUUID();
        await holdBookingSeats(flight.id, ['10B'], idempotencyKey);

        const booking = await FlightBookingService.bookFlight({
            userId: testUser.id,
            flightIds: [flight.id],
            idempotencyKey,
            passengers: [{
                firstName: 'John',
                lastName: 'Connor',
                dateOfBirth: '1985-05-12',
                passportNumber: 'P12345678',
                gender: 'M',
                cabinClass: 'ECONOMY',
                seatNumbers: ['10B'],
            }],
            ancillariesByPassenger: {
                0: ['CHECKED_BAG_1'],
            },
        });
        created.bookingIds.push(booking.id);

        const fetched = await FlightBookingService.findBookingById(booking.id);
        expect(fetched).not.toBeNull();
        expect(fetched?.passengers[0].ancillaries).toHaveLength(1);
        expect(fetched?.passengers[0].ancillaries[0].type).toBe('CHECKED_BAG_1');
        expect(fetched?.passengers[0].ancillaries[0].priceCents).toBe(3500);
    });
});
