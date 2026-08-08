/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import FlightBookingService from '@/lib/FlightBookingService';
import { updateFlightSeatingLayout } from '@/lib/FlightSeatLayoutService';

const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

const ROOMY = {
    firstClassRows: 3,
    businessRows: 3,
    premiumEconomyRows: 4,
    economyRows: 20,
    seatPattern: 'ABC-DEF',
};

async function createFlight(suffix: string, from: string, to: string, day: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `LAY-${suffix}`,
            airline: 'Gemini Airways',
            ...airportCodesForRoute(from, to),
            departureDate: new Date(`${day}T08:00:00Z`),
            priceCents: 35000,
            status: 'ON_TIME',
            ...ROOMY,
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

describe('updateFlightSeatingLayout with a round trip on the flight', () => {
    it('refuses a layout that would strand a seat held on the return leg', async () => {
        const suffix = `${Date.now()}`;
        const outbound = await createFlight(`O${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-11-01');
        const inbound = await createFlight(`I${suffix}`, 'Detroit, USA', 'Seattle, USA', '2027-11-08');
        const user = await prisma.user.create({
            data: {
                name: 'Layout',
                email: `layout-${suffix}@example.com`,
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
                seatNumbers: ['11A', '25F'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        // Row 25 disappears when economy shrinks to 5 rows. The seat is held on
        // the inbound flight, which is the booking's second leg -- the guard
        // has to see it there, not only where Passenger.flightId points.
        await expect(
            updateFlightSeatingLayout(inbound.id, { ...ROOMY, economyRows: 5 })
        ).rejects.toThrow(/Occupied seat 25F/);

        const unchanged = await prisma.flight.findUniqueOrThrow({ where: { id: inbound.id } });
        expect(unchanged.economyRows).toBe(20);
    });

    it('allows a layout that still contains every held seat', async () => {
        const suffix = `${Date.now()}b`;
        const flight = await createFlight(`A${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-12-01');
        const user = await prisma.user.create({
            data: {
                name: 'Layout Ok',
                email: `layout-ok-${suffix}@example.com`,
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
                seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        await updateFlightSeatingLayout(flight.id, { ...ROOMY, economyRows: 15 });
        const updated = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
        expect(updated.economyRows).toBe(15);
    });
    it('ignores a seat whose booking was cancelled', async () => {
        // This is the one place the occupancy rule has teeth. Elsewhere a
        // cancellation is invisible anyway, because it renames the seat to a
        // CANCELLED-<passengerId> placeholder that can never match a real seat
        // id. Here the stored seat number is *interpreted* rather than matched,
        // so without the rule the placeholder is read back as an occupied seat
        // and every layout change on the flight is refused forever (#143).
        const suffix = `${Date.now()}c`;
        const flight = await createFlight(`C${suffix}`, 'Seattle, USA', 'Detroit, USA', '2027-12-02');
        const user = await prisma.user.create({
            data: {
                name: 'Layout Cancelled',
                email: `layout-cancelled-${suffix}@example.com`,
                password: 'not-used',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(user.id);

        const booking = await new FlightBookingService().bookFlight({
            flightIds: [flight.id],
            userId: user.id,
            passengers: [{
                firstName: 'Ada',
                lastName: 'Lovelace',
                dateOfBirth: new Date('1990-01-01'),
                passportNumber: 'US1112223',
                gender: 'Female',
                // The last economy row, so a shrink would strand it.
                seatNumbers: ['20F'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: randomUUID(),
        });
        created.bookingIds.push(booking.id);

        // Exactly what cancelBookingAction leaves behind: the booking marked
        // cancelled and the seat parked under a placeholder.
        const held = await prisma.seatAssignment.findFirstOrThrow({
            where: { leg: { bookingId: booking.id } },
        });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        await prisma.seatAssignment.update({
            where: { id: held.id },
            data: { seatNumber: `CANCELLED-${held.passengerId}` },
        });

        await updateFlightSeatingLayout(flight.id, { ...ROOMY, economyRows: 15 });
        const updated = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
        expect(updated.economyRows).toBe(15);
    });
});
