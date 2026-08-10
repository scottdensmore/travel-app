/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { heldSeats } from '@/lib/seatOccupancy';
import { updateFlightStatusAction } from '@/app/actions';
import { getServerSession } from 'next-auth';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
// `lib/auth` reaches @auth/prisma-adapter, which ships ESM Jest cannot parse.
// Only `authOptions` is needed here, and only as a value to pass along.
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockedGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

/**
 * What a staff cancellation does to the people already booked on the flight.
 *
 * It used to do nothing at all. `updateFlightStatusAction` wrote the flight's
 * status and sent a notification, and the bookings stayed CONFIRMED holding
 * their seats -- so a customer kept a boarding pass for a flight that was not
 * operating, and cancelling it themselves cost them the Economy fee for the
 * airline's decision (#76).
 *
 * They move to DISRUPTED rather than CANCELLED, which is the decision this
 * issue took: the seat stays held, the customer keeps the choice, and a
 * misclick can be taken back.
 */
const created = { flightIds: [] as number[], userIds: [] as string[] };

async function aFlight(status: 'ON_TIME' | 'CANCELLED' = 'ON_TIME') {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `DSR-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
            priceCents: 35_000,
            status,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function aBookingOn(flightIds: number[], seatNumber = '7A') {
    const user = await prisma.user.create({
        data: { email: `disruption-${randomUUID()}@example.com` },
    });
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            totalPriceCents: 35_000 * flightIds.length,
            legs: {
                create: flightIds.map((flightId, index) => ({ sequence: index + 1, flightId })),
            },
            passengers: {
                create: [{
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    gender: 'Female',
                    sensitiveDataDeletedAt: new Date(),
                }],
            },
        },
        include: { legs: true, passengers: true },
    });

    await prisma.seatAssignment.createMany({
        data: booking.legs.map(leg => ({
            passengerId: booking.passengers[0].id,
            legId: leg.id,
            flightId: leg.flightId,
            seatNumber,
            cabinClass: 'ECONOMY' as const,
        })),
    });

    return booking;
}

const statusOf = async (bookingId: number) =>
    (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status;

beforeEach(() => {
    mockedGetServerSession.mockResolvedValue({
        user: { id: 'staff-disruption', role: 'ADMIN', staffMfaVerified: true },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
});

beforeAll(async () => {
    await prisma.user.upsert({
        where: { id: 'staff-disruption' },
        update: {},
        create: { id: 'staff-disruption', email: `staff-${randomUUID()}@example.com`, role: 'ADMIN' },
    });
    created.userIds.push('staff-disruption');
});

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('cancelling a flight', () => {
    it('disrupts its bookings rather than cancelling them', async () => {
        const flight = await aFlight();
        const booking = await aBookingOn([flight.id]);

        await updateFlightStatusAction(flight.id, 'CANCELLED');

        expect(await statusOf(booking.id)).toBe('DISRUPTED');
    });

    it('leaves the seat held while the customer decides', async () => {
        // The reason for DISRUPTED over CANCELLED: releasing the seat would
        // foreclose the rebooking the customer has not chosen yet.
        const flight = await aFlight();
        const booking = await aBookingOn([flight.id], '7B');

        await updateFlightStatusAction(flight.id, 'CANCELLED');

        expect(await prisma.seatAssignment.count({
            where: heldSeats({ flightId: flight.id, seatNumber: '7B' }),
        })).toBe(1);
        expect(await statusOf(booking.id)).toBe('DISRUPTED');
    });

    it('disrupts a whole itinerary when one of its legs is cancelled', async () => {
        // Half a trip is not a usable trip.
        const outbound = await aFlight();
        const inbound = await aFlight();
        const booking = await aBookingOn([outbound.id, inbound.id], '7C');

        await updateFlightStatusAction(inbound.id, 'CANCELLED');

        expect(await statusOf(booking.id)).toBe('DISRUPTED');
    });

    it('records who did it and why, on the history', async () => {
        const flight = await aFlight();
        const booking = await aBookingOn([flight.id], '7D');

        await updateFlightStatusAction(flight.id, 'CANCELLED');

        const change = await prisma.bookingStatusChange.findFirst({
            where: { bookingId: booking.id, to: 'DISRUPTED' },
        });
        expect(change).toMatchObject({ from: 'CONFIRMED', actorUserId: 'staff-disruption' });
        expect(change!.reason).toMatch(/cancelled by the airline/i);
    });

    it('leaves a booking the customer already cancelled alone', async () => {
        const flight = await aFlight();
        const booking = await aBookingOn([flight.id], '7E');
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

        await updateFlightStatusAction(flight.id, 'CANCELLED');

        expect(await statusOf(booking.id)).toBe('CANCELLED');
    });
});

describe('putting a cancelled flight back', () => {
    it('reinstates the bookings it disrupted', async () => {
        // The whole reason a cancellation here is not a one-way door.
        const flight = await aFlight();
        const booking = await aBookingOn([flight.id], '8A');
        await updateFlightStatusAction(flight.id, 'CANCELLED');

        await updateFlightStatusAction(flight.id, 'ON_TIME');

        expect(await statusOf(booking.id)).toBe('CONFIRMED');
    });

    it('leaves a trip whose other leg is still cancelled disrupted', async () => {
        const outbound = await aFlight();
        const inbound = await aFlight();
        const booking = await aBookingOn([outbound.id, inbound.id], '8B');
        await updateFlightStatusAction(outbound.id, 'CANCELLED');
        await updateFlightStatusAction(inbound.id, 'CANCELLED');

        await updateFlightStatusAction(outbound.id, 'ON_TIME');

        expect(await statusOf(booking.id)).toBe('DISRUPTED');
    });

    it('does not resurrect a booking the customer cancelled in the meantime', async () => {
        // Their decision, not the airline's to undo.
        const flight = await aFlight();
        const booking = await aBookingOn([flight.id], '8C');
        await updateFlightStatusAction(flight.id, 'CANCELLED');
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

        await updateFlightStatusAction(flight.id, 'ON_TIME');

        expect(await statusOf(booking.id)).toBe('CANCELLED');
    });
});

describe('two legs of one itinerary changing status at once', () => {
    /**
     * The race the flight lock alone does not cover.
     *
     * Each transaction locks its own flight, but what a booking should become
     * depends on the *other* legs' flights -- rows it does not hold. Under READ
     * COMMITTED both transactions read the other's pre-image and both decide
     * wrongly. Reproduced 27 times in 30 before the bookings themselves were
     * locked (#76).
     *
     * Each admin row has its own transition and disables only its own select,
     * so one person changing two rows is enough to reach this.
     */
    it('never leaves a booking confirmed on a cancelled flight', async () => {
        for (let round = 0; round < 8; round++) {
            const outbound = await aFlight();
            const inbound = await aFlight();
            const booking = await aBookingOn([outbound.id, inbound.id], `9${round}A`);
            await updateFlightStatusAction(outbound.id, 'CANCELLED');

            // Reinstate one leg while the other is being cancelled.
            await Promise.all([
                updateFlightStatusAction(outbound.id, 'ON_TIME'),
                updateFlightStatusAction(inbound.id, 'CANCELLED'),
            ]);

            const grounded = await prisma.flight.count({
                where: { id: { in: [outbound.id, inbound.id] }, status: 'CANCELLED' },
            });
            const status = await statusOf(booking.id);
            // Whichever order they landed in, the booking has to agree with
            // the flights: disrupted if any leg is cancelled, confirmed if not.
            expect({ round, status }).toEqual({
                round,
                status: grounded > 0 ? 'DISRUPTED' : 'CONFIRMED',
            });
        }
    });

    it('never leaves a booking disrupted once every leg is operating again', async () => {
        // The mirror, and the harder one to recover from: the admin selects
        // already read ON TIME, so nothing prompts staff to fix it.
        for (let round = 0; round < 8; round++) {
            const outbound = await aFlight();
            const inbound = await aFlight();
            const booking = await aBookingOn([outbound.id, inbound.id], `9${round}B`);
            await updateFlightStatusAction(outbound.id, 'CANCELLED');
            await updateFlightStatusAction(inbound.id, 'CANCELLED');

            await Promise.all([
                updateFlightStatusAction(outbound.id, 'ON_TIME'),
                updateFlightStatusAction(inbound.id, 'ON_TIME'),
            ]);

            expect({ round, status: await statusOf(booking.id) })
                .toEqual({ round, status: 'CONFIRMED' });
        }
    });
});
