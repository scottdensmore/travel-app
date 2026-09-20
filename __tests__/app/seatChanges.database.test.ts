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

    it('rejects seat change requests from a non-owner and leaves seats intact', async () => {
        const suffix = `${Date.now()}c`;
        const flight = await createFlight(`F${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-08-01');
        const owner = await createUser(`${suffix}owner`);
        const nonOwner = await createUser(`${suffix}intruder`);

        const booking = await bookHeldFlight(new FlightBookingService(), {
            flightIds: [flight.id],
            userId: owner.id,
            passengers: [{
                firstName: 'Katherine',
                lastName: 'Johnson',
                dateOfBirth: new Date('1990-01-01'),
                passportNumber: 'US1234567',
                gender: 'Female',
                seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        const legs = await prisma.itineraryLeg.findMany({
            where: { bookingId: booking.id },
            include: { seatAssignments: true },
        });
        const passengerId = legs[0].seatAssignments[0].passengerId;

        // Attempt seat change as nonOwner
        mockedSession.mockResolvedValue({ user: { id: nonOwner.id } });

        await expect(changeBookingSeatsAction(booking.id, [
            { passengerId, legId: legs[0].id, seatNumber: '12B' },
        ])).rejects.toThrow('Unauthorized');

        // Seat remains unchanged in database
        const afterAssignment = await prisma.seatAssignment.findFirst({
            where: { legId: legs[0].id, passengerId },
        });
        expect(afterAssignment?.seatNumber).toBe('11A');
    });

    it('fails cleanly without corruption when two transactions race for the same seat concurrently and preserves ancillaries', async () => {
        const suffix = `${Date.now()}d`;
        const flight = await createFlight(`F${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-09-01');
        const user = await createUser(suffix);

        const bookingA = await bookHeldFlight(new FlightBookingService(), {
            flightIds: [flight.id],
            userId: user.id,
            passengers: [{
                firstName: 'Alice',
                lastName: 'Smith',
                dateOfBirth: new Date('1990-01-01'),
                passportNumber: 'US1111111',
                gender: 'Female',
                seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(bookingA.id);

        const bookingB = await bookHeldFlight(new FlightBookingService(), {
            flightIds: [flight.id],
            userId: user.id,
            passengers: [{
                firstName: 'Bob',
                lastName: 'Jones',
                dateOfBirth: new Date('1992-02-02'),
                passportNumber: 'US2222222',
                gender: 'Male',
                seatNumbers: ['12A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(bookingB.id);

        const legsA = await prisma.itineraryLeg.findMany({
            where: { bookingId: bookingA.id },
            include: { seatAssignments: true },
        });
        const legsB = await prisma.itineraryLeg.findMany({
            where: { bookingId: bookingB.id },
            include: { seatAssignments: true },
        });

        const passengerAId = legsA[0].seatAssignments[0].passengerId;
        const passengerBId = legsB[0].seatAssignments[0].passengerId;

        // Add an ancillary to Alice
        await prisma.passengerAncillary.create({
            data: {
                passengerId: passengerAId,
                type: 'CHECKED_BAG_1',
                priceCents: 3500,
            },
        });

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        // Both attempt to claim the exact same target seat '14B' concurrently
        const [resultA, resultB] = await Promise.allSettled([
            changeBookingSeatsAction(bookingA.id, [
                { passengerId: passengerAId, legId: legsA[0].id, seatNumber: '14B' },
            ]),
            changeBookingSeatsAction(bookingB.id, [
                { passengerId: passengerBId, legId: legsB[0].id, seatNumber: '14B' },
            ]),
        ]);

        const fulfilled = [resultA, resultB].filter(r => r.status === 'fulfilled');
        const rejected = [resultA, resultB].filter(r => r.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
        expect(rejectedReason.message).toMatch(/already occupied/i);

        // Verify exactly one active assignment has 14B on this flight
        const assignmentsOnFlight = await prisma.seatAssignment.findMany({
            where: { flightId: flight.id, seatNumber: '14B', releasedAt: null },
        });
        expect(assignmentsOnFlight).toHaveLength(1);

        // Verify that passenger A's ancillary remains intact
        const ancillariesA = await prisma.passengerAncillary.findMany({
            where: { passengerId: passengerAId },
        });
        expect(ancillariesA).toHaveLength(1);
        expect(ancillariesA[0].type).toBe('CHECKED_BAG_1');
    });
});
