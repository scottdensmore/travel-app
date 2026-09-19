/** @jest-environment node */
import { randomUUID } from 'crypto';
import FlightBookingService from '@/lib/FlightBookingService';
import { holdBookingSeats } from '@/e2e/helpers/holdBookingSeats';
import { prisma } from '@/lib/prisma';

describe('FlightBookingService database integration', () => {
    const created = {
        flightIds: [] as number[],
        userIds: [] as string[],
        bookingIds: [] as number[],
    };

    let testUser: { id: string };

    beforeAll(async () => {
        testUser = await prisma.user.create({
            data: {
                name: 'MultiCity Test User',
                email: `multicity-db-${randomUUID()}@example.com`,
                password: 'password123',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(testUser.id);
    });

    afterAll(async () => {
        if (created.bookingIds.length > 0) {
            await prisma.seatAssignment.deleteMany({
                where: { leg: { bookingId: { in: created.bookingIds } } },
            });
            await prisma.passenger.deleteMany({
                where: { bookingId: { in: created.bookingIds } },
            });
            await prisma.booking.deleteMany({
                where: { id: { in: created.bookingIds } },
            });
        }
        if (created.flightIds.length > 0) {
            await prisma.seatHold.deleteMany({
                where: { flightId: { in: created.flightIds } },
            });
            await prisma.flight.deleteMany({
                where: { id: { in: created.flightIds } },
            });
        }
        if (created.userIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: created.userIds } },
            });
        }
        await prisma.$disconnect();
    });

    async function createTestFlight(route: { from: string; to: string }) {
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
        const flight1 = await createTestFlight({ from: 'SEA', to: 'DTW' });
        const flight2 = await createTestFlight({ from: 'DTW', to: 'JFK' });
        const flight3 = await createTestFlight({ from: 'JFK', to: 'SEA' });

        const bookingPayload = {
            userId: testUser.id,
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

        await holdBookingSeats(bookingPayload);
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
