/** @jest-environment node */
import { prisma } from '@/lib/prisma';

const created = { flightIds: [] as number[], bookingIds: [] as number[] };

async function createFlight(suffix: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `SEAT-${suffix}`,
            airline: 'Gemini Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: new Date('2027-05-01T08:00:00Z'),
            priceCents: 35000,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

/**
 * A booking with one traveller and one leg, carrying no seat of its own: where
 * somebody sits is a SeatAssignment, which is what these tests exercise (#137).
 */
async function createBooking(flightId: number) {
    const booking = await prisma.booking.create({
        data: {
            legs: { create: [{ sequence: 1, flightId }] },
            passengers: {
                create: [{
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    gender: 'Female',
                    // A traveller whose sensitive data has already been purged
                    // under the retention policy, so this fixture needs no
                    // encryption keys. Passenger_sensitive_data_state_check
                    // requires one of the two valid states.
                    sensitiveDataDeletedAt: new Date(),
                }],
            },
        },
        include: { legs: true, passengers: true },
    });
    created.bookingIds.push(booking.id);
    return booking;
}

describe('seat assignments in PostgreSQL', () => {
    afterAll(async () => {
        await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        await prisma.$disconnect();
    });

    it('still refuses the same seat on the same flight to a second booking', async () => {
        // This is the guard that prevents two customers acquiring one seat.
        // Dropping Passenger's unique seat index left this table holding it
        // alone (#137), so it has to hold here.
        const flight = await createFlight(`CONTESTED-${Date.now()}`);
        const first = await createBooking(flight.id);
        const second = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: flight.id }] } },
            include: { legs: true },
        });
        created.bookingIds.push(second.id);

        await prisma.seatAssignment.create({
            data: {
                passengerId: first.passengers[0].id,
                legId: first.legs[0].id,
                flightId: flight.id,
                seatNumber: '3C',
                cabinClass: 'ECONOMY',
            },
        });

        const rival = await prisma.passenger.create({
            data: {
                firstName: 'Grace', lastName: 'Hopper', gender: 'Female',
                bookingId: second.id,
                sensitiveDataDeletedAt: new Date(),
            },
        });

        await expect(prisma.seatAssignment.create({
            data: {
                passengerId: rival.id,
                legId: second.legs[0].id,
                flightId: flight.id,
                seatNumber: '3C',
                cabinClass: 'ECONOMY',
            },
        })).rejects.toThrow();
    });

    it('refuses a seat whose flight disagrees with its leg', async () => {
        // The denormalised flightId exists so the uniqueness constraint can be
        // expressed; the composite key is what stops it drifting from the leg.
        const flight = await createFlight(`CONSISTENT-${Date.now()}`);
        const other = await createFlight(`OTHER-${Date.now()}`);
        const booking = await createBooking(flight.id);

        await expect(prisma.seatAssignment.create({
            data: {
                passengerId: booking.passengers[0].id,
                legId: booking.legs[0].id,
                flightId: other.id,
                seatNumber: '9F',
                cabinClass: 'ECONOMY',
            },
        })).rejects.toThrow();
    });

    it('seats a traveller only once on a given leg', async () => {
        const flight = await createFlight(`ONCE-${Date.now()}`);
        const booking = await createBooking(flight.id);
        const passengerId = booking.passengers[0].id;
        const legId = booking.legs[0].id;

        await prisma.seatAssignment.create({
            data: { passengerId, legId, flightId: flight.id, seatNumber: '7B', cabinClass: 'ECONOMY' },
        });

        await expect(prisma.seatAssignment.create({
            data: { passengerId, legId, flightId: flight.id, seatNumber: '7C', cabinClass: 'ECONOMY' },
        })).rejects.toThrow();
    });

    it('removes seat assignments when the booking is deleted', async () => {
        const flight = await createFlight(`CASCADE-${Date.now()}`);
        const booking = await createBooking(flight.id);
        await prisma.seatAssignment.create({
            data: {
                passengerId: booking.passengers[0].id,
                legId: booking.legs[0].id,
                flightId: flight.id,
                seatNumber: '2A',
                cabinClass: 'ECONOMY',
            },
        });

        await prisma.booking.delete({ where: { id: booking.id } });

        await expect(prisma.seatAssignment.findMany({ where: { flightId: flight.id } }))
            .resolves.toEqual([]);
    });
});
