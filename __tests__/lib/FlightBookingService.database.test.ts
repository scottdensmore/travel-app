/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import FlightBookingService from '@/lib/FlightBookingService';
import { airportCodesForRoute } from '@/lib/airports';
import { checkoutHolderKey, holdSeat } from '@/lib/seatHolds';
import { holdBookingSeats as holdMultiCitySeats } from '@/e2e/helpers/holdBookingSeats';
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
    if (created.bookingIds.length > 0 || created.userIds.length > 0) {
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
        await prisma.itineraryLeg.deleteMany({
            where: {
                OR: [
                    { flightId: { in: created.flightIds } },
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
    }
    if (created.flightIds.length > 0) {
        await prisma.seatHold.deleteMany({ where: { flightId: { in: created.flightIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    }
    if (created.userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    }
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

describe('FlightBookingService database integration', () => {
    let multiCityUser: { id: string };

    beforeAll(async () => {
        multiCityUser = await prisma.user.create({
            data: {
                name: 'MultiCity Test User',
                email: `multicity-db-${randomUUID()}@example.com`,
                password: 'password123',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(multiCityUser.id);
    });

    async function createMultiCityTestFlight(route: { from: string; to: string }) {
        const flight = await prisma.flight.create({
            data: {
                flightNumber: `MC-${randomUUID().slice(0, 8)}`,
                airline: 'Mona Airways',
                fromAirportCode: route.from,
                toAirportCode: route.to,
                departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                priceCents: 35000,
                status: 'ON_TIME',
                economyRows: 20,
                premiumEconomyRows: 4,
                businessRows: 3,
                firstClassRows: 3,
                seatPattern: 'ABC-DEF',
            },
        });
        created.flightIds.push(flight.id);
        return flight;
    }

    it('creates a 3-leg multi-city booking with ascending sequence numbers and distinct seat assignments', async () => {
        const flight1 = await createMultiCityTestFlight({ from: 'SEA', to: 'DTW' });
        const flight2 = await createMultiCityTestFlight({ from: 'DTW', to: 'JFK' });
        const flight3 = await createMultiCityTestFlight({ from: 'JFK', to: 'SEA' });

        const bookingPayload = {
            userId: multiCityUser.id,
            flightIds: [flight1.id, flight2.id, flight3.id],
            idempotencyKey: randomUUID(),
            passengers: [{
                firstName: 'Alice',
                lastName: 'Walker',
                dateOfBirth: '1992-04-10',
                passportNumber: 'P12345678',
                gender: 'Female',
                cabinClass: 'ECONOMY' as const,
                seatNumbers: ['11A', '12B', '14C'],
            }],
        };

        await holdMultiCitySeats(bookingPayload);
        const booking = await FlightBookingService.bookFlight(bookingPayload);
        created.bookingIds.push(booking.id);

        expect(booking.legs).toHaveLength(3);
        expect(booking.legs.map(l => l.sequence)).toEqual([1, 2, 3]);
        expect(booking.legs[0].flightId).toBe(flight1.id);
        expect(booking.legs[1].flightId).toBe(flight2.id);
        expect(booking.legs[2].flightId).toBe(flight3.id);

        // Verify database persistence of legs and seat assignments
        const legsInDb = await prisma.itineraryLeg.findMany({
            where: { bookingId: booking.id },
            orderBy: { sequence: 'asc' },
            include: { seatAssignments: true },
        });
        expect(legsInDb).toHaveLength(3);
        expect(legsInDb.map(l => l.sequence)).toEqual([1, 2, 3]);
        expect(legsInDb[0].flightId).toBe(flight1.id);
        expect(legsInDb[1].flightId).toBe(flight2.id);
        expect(legsInDb[2].flightId).toBe(flight3.id);

        expect(legsInDb[0].seatAssignments).toHaveLength(1);
        expect(legsInDb[0].seatAssignments[0].seatNumber).toBe('11A');
        expect(legsInDb[1].seatAssignments).toHaveLength(1);
        expect(legsInDb[1].seatAssignments[0].seatNumber).toBe('12B');
        expect(legsInDb[2].seatAssignments).toHaveLength(1);
        expect(legsInDb[2].seatAssignments[0].seatNumber).toBe('14C');
    });
});
