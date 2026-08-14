/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
import { changeBookingSeatsAction } from '@/app/actions';
import { getServerSession } from 'next-auth';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import FlightBookingService from '@/lib/FlightBookingService';
import { bookHeldFlight } from '@/e2e/helpers/holdBookingSeats';

// Only the session and cache boundaries are stubbed; the database is real,
// because what is under test is which rows a seat change touches.
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const mockedSession = getServerSession as jest.Mock;

const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

async function createFlight(suffix: string, from: string, to: string, day: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `CHG-${suffix}`,
            airline: 'Gemini Airways',
            ...airportCodesForRoute(from, to),
            departureDate: new Date(`${day}T08:00:00Z`),
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

async function createUser(suffix: string) {
    const user = await prisma.user.create({
        data: {
            name: 'Seat Change',
            email: `seatchange-${suffix}-${Date.now()}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);
    return user;
}

afterAll(async () => {
    for (const bookingId of created.bookingIds) {
        await prisma.passenger.deleteMany({ where: { bookingId } });
        await prisma.booking.deleteMany({ where: { id: bookingId } });
    }
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('changeBookingSeatsAction on a round trip', () => {
    it('changes the named leg and leaves the other leg alone', async () => {
        const suffix = `${Date.now()}`;
        const outbound = await createFlight(`O${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-06-01');
        const inbound = await createFlight(`I${suffix}`, 'Detroit, USA', 'Seattle, USA', '2027-06-08');
        const user = await createUser(suffix);

        const booking = await bookHeldFlight(new FlightBookingService(), {
            flightIds: [outbound.id, inbound.id],
            userId: user.id,
            passengers: [{
                firstName: 'Ada',
                lastName: 'Lovelace',
                dateOfBirth: new Date('1990-01-01'),
                passportNumber: 'US1112223',
                gender: 'Female',
                seatNumbers: ['11A', '12C'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        const legs = await prisma.itineraryLeg.findMany({
            where: { bookingId: booking.id },
            orderBy: { sequence: 'asc' },
            include: { seatAssignments: true },
        });
        expect(legs.map(leg => leg.seatAssignments[0].seatNumber)).toEqual(['11A', '12C']);

        const passengerId = legs[0].seatAssignments[0].passengerId;
        mockedSession.mockResolvedValue({ user: { id: user.id } });

        // Move the outbound seat only.
        await changeBookingSeatsAction(booking.id, [
            { passengerId, legId: legs[0].id, seatNumber: '14B' },
        ]);

        const after = await prisma.itineraryLeg.findMany({
            where: { bookingId: booking.id },
            orderBy: { sequence: 'asc' },
            include: { seatAssignments: true },
        });

        // The return seat must survive untouched. A change keyed only on the
        // passenger would overwrite every leg's seat with the new number.
        expect(after[0].seatAssignments[0].seatNumber).toBe('14B');
        expect(after[1].seatAssignments[0].seatNumber).toBe('12C');
    });

    it('frees the seat it moved off so another booking can take it', async () => {
        const suffix = `${Date.now()}b`;
        const outbound = await createFlight(`O${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-07-01');
        const inbound = await createFlight(`I${suffix}`, 'Detroit, USA', 'Seattle, USA', '2027-07-08');
        const user = await createUser(suffix);

        const booking = await bookHeldFlight(new FlightBookingService(), {
            flightIds: [outbound.id, inbound.id],
            userId: user.id,
            passengers: [{
                firstName: 'Grace',
                lastName: 'Hopper',
                dateOfBirth: new Date('1985-05-05'),
                passportNumber: 'US4445556',
                gender: 'Female',
                seatNumbers: ['11A', '11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        const legs = await prisma.itineraryLeg.findMany({
            where: { bookingId: booking.id },
            orderBy: { sequence: 'asc' },
            include: { seatAssignments: true },
        });
        const passengerId = legs[1].seatAssignments[0].passengerId;
        mockedSession.mockResolvedValue({ user: { id: user.id } });

        // Move the return seat; the outbound keeps 11A on its own flight.
        await changeBookingSeatsAction(booking.id, [
            { passengerId, legId: legs[1].id, seatNumber: '15D' },
        ]);

        const assignments = await prisma.seatAssignment.findMany({
            where: { leg: { bookingId: booking.id } },
            orderBy: { leg: { sequence: 'asc' } },
        });
        expect(assignments.map(a => a.seatNumber)).toEqual(['11A', '15D']);

        // 11A on the inbound flight is free again, so the unique index accepts it.
        const other = await createUser(`${suffix}other`);
        const secondBooking = await bookHeldFlight(new FlightBookingService(), {
            flightIds: [inbound.id],
            userId: other.id,
            passengers: [{
                firstName: 'Alan',
                lastName: 'Turing',
                dateOfBirth: new Date('1980-02-02'),
                passportNumber: 'US7778889',
                gender: 'Male',
                seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(secondBooking.id);

        const retaken = await prisma.seatAssignment.findFirst({
            where: { flightId: inbound.id, seatNumber: '11A' },
        });
        expect(retaken).not.toBeNull();
    });
});
