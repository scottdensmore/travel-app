/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
import { getOccupiedSeatsAction } from '@/app/actions';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import FlightBookingService from '@/lib/FlightBookingService';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const mockedGetServerSession = getServerSession as unknown as jest.Mock;

beforeEach(() => {
    // The action refuses an unauthenticated caller (#154). These cases are
    // about which seats come back, not about who is asking, so they run as a
    // signed-in traveller; the refusal itself is covered in actions.test.ts.
    mockedGetServerSession.mockResolvedValue({ user: { id: 'occupied-seats-suite' } });
});

const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

async function createFlight(suffix: string, from: string, to: string, day: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `OCC-${suffix}`,
            airline: 'Gemini Airways',
            from,
            to,
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

afterAll(async () => {
    for (const bookingId of created.bookingIds) {
        await prisma.passenger.deleteMany({ where: { bookingId } });
        await prisma.booking.deleteMany({ where: { id: bookingId } });
    }
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('getOccupiedSeatsAction across an itinerary', () => {
    it('reports the seats taken on the flight asked about, not the outbound seat', async () => {
        const suffix = `${Date.now()}`;
        const outbound = await createFlight(`O${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-09-01');
        const inbound = await createFlight(`I${suffix}`, 'Detroit, USA', 'Seattle, USA', '2027-09-08');
        const user = await prisma.user.create({
            data: {
                name: 'Occupancy',
                email: `occupancy-${suffix}@example.com`,
                password: 'not-used',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(user.id);

        const booking = await new FlightBookingService().bookFlight({
            flightIds: [outbound.id, inbound.id],
            userId: user.id,
            passengers: [{
                firstName: 'Ada',
                lastName: 'Lovelace',
                dateOfBirth: new Date('1990-01-01'),
                passportNumber: 'US1112223',
                gender: 'Female',
                // Deliberately different per leg, so reading the wrong table
                // cannot accidentally give the right answer.
                seatNumbers: ['11A', '17F'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        expect(await getOccupiedSeatsAction(outbound.id)).toEqual(['11A']);
        // The return leg holds 17F. Reading Passenger.seatNumber would answer
        // 11A here, marking a free seat taken and the taken one free.
        expect(await getOccupiedSeatsAction(inbound.id)).toEqual(['17F']);
    });

    it('reports nothing once the booking is cancelled', async () => {
        const suffix = `${Date.now()}c`;
        const flight = await createFlight(`C${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-10-01');
        const user = await prisma.user.create({
            data: {
                name: 'Occupancy Cancel',
                email: `occupancy-cancel-${suffix}@example.com`,
                password: 'not-used',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(user.id);

        const booking = await new FlightBookingService().bookFlight({
            flightIds: [flight.id],
            userId: user.id,
            passengers: [{
                firstName: 'Grace',
                lastName: 'Hopper',
                dateOfBirth: new Date('1985-05-05'),
                passportNumber: 'US4445556',
                gender: 'Female',
                seatNumbers: ['12B'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        expect(await getOccupiedSeatsAction(flight.id)).toEqual(['12B']);

        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        expect(await getOccupiedSeatsAction(flight.id)).toEqual([]);
    });
});
