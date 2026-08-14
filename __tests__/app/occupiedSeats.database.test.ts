/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
import { getOccupiedSeatsAction, holdChosenSeatsAction } from '@/app/actions';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import FlightBookingService from '@/lib/FlightBookingService';
import { holdSeat } from '@/lib/seatHolds';

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

const created = {
    flightIds: [] as number[],
    bookingIds: [] as number[],
    userIds: [] as string[],
    holderKeys: [] as string[],
};

async function createFlight(suffix: string, from: string, to: string, day: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `OCC-${suffix}`,
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

afterAll(async () => {
    await prisma.seatHold.deleteMany({
        where: {
            OR: [
                { holderKey: { in: created.holderKeys } },
                { flightId: { in: created.flightIds } },
            ],
        },
    });
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

describe('a seat another customer is choosing', () => {
    it('keeps two checkouts belonging to the same customer independent', async () => {
        const flight = await createFlight(
            randomUUID().slice(0, 6),
            'Seattle, USA',
            'Detroit, USA',
            '2026-09-01',
        );
        const [firstCheckout, secondCheckout] = [randomUUID(), randomUUID()];

        await expect(holdChosenSeatsAction({
            checkoutId: firstCheckout,
            claims: [{ flightId: flight.id, seatNumber: '12A' }],
        })).resolves.toEqual({ ok: true });
        await expect(holdChosenSeatsAction({
            checkoutId: secondCheckout,
            claims: [{ flightId: flight.id, seatNumber: '12B' }],
        })).resolves.toEqual({ ok: true });

        let rows = await prisma.seatHold.findMany({
            where: { flightId: flight.id },
            orderBy: { seatNumber: 'asc' },
        });
        expect(rows.map(row => row.seatNumber)).toEqual(['12A', '12B']);
        expect(new Set(rows.map(row => row.holderKey))).toHaveProperty('size', 2);

        // Updating the second checkout releases only its abandoned seat. The
        // first tab's 12A remains held even though both tabs share one session.
        await expect(holdChosenSeatsAction({
            checkoutId: secondCheckout,
            claims: [{ flightId: flight.id, seatNumber: '12C' }],
        })).resolves.toEqual({ ok: true });

        rows = await prisma.seatHold.findMany({
            where: { flightId: flight.id },
            orderBy: { seatNumber: 'asc' },
        });
        expect(rows.map(row => row.seatNumber)).toEqual(['12A', '12C']);
    });

    it('counts every live hold when the caller has no checkout identity', async () => {
        // The read half of #74. Without it the hold decides races invisibly:
        // both customers still see the seat as free, and the loser only finds
        // out when advancing to payment fails.
        const flight = await createFlight(randomUUID().slice(0, 6), 'Seattle, USA', 'Detroit, USA', '2026-09-01');
        const rival = `rival-${randomUUID()}`;
        created.holderKeys.push(rival, 'occupied-seats-suite');

        await holdSeat({ flightId: flight.id, seatNumber: '14A', holderKey: rival });
        await holdSeat({ flightId: flight.id, seatNumber: '14B', holderKey: 'occupied-seats-suite' });

        // This action also serves the profile seat-change modal and the first
        // server render of checkout, neither of which owns a checkout key.
        // Excluding every hold for the signed-in user would let one journey
        // ignore a seat that user's other tab is already buying.
        expect(await getOccupiedSeatsAction(flight.id)).toEqual(['14A', '14B']);
    });

    it('stops counting once the hold has expired', async () => {
        const flight = await createFlight(randomUUID().slice(0, 6), 'Seattle, USA', 'Detroit, USA', '2026-09-02');
        const rival = `rival-${randomUUID()}`;
        created.holderKeys.push(rival);

        await holdSeat({ flightId: flight.id, seatNumber: '15C', holderKey: rival });
        expect(await getOccupiedSeatsAction(flight.id)).toContain('15C');

        await prisma.seatHold.updateMany({
            where: { flightId: flight.id, seatNumber: '15C' },
            data: {
                createdAt: new Date(Date.now() - 60 * 60_000),
                expiresAt: new Date(Date.now() - 60_000),
            },
        });

        expect(await getOccupiedSeatsAction(flight.id)).not.toContain('15C');
    });
});
