/** @jest-environment node */
import { prisma } from '@/lib/prisma';

async function createFlight(flightNumber: string) {
    return prisma.flight.create({
        data: {
            flightNumber,
            airline: 'Gemini Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: new Date(`2027-03-01T08:00:00Z`),
            priceCents: 35000,
        },
    });
}

describe('itinerary legs in PostgreSQL', () => {
    const created = { flightIds: [] as number[], bookingIds: [] as number[] };

    afterAll(async () => {
        await prisma.itineraryLeg.deleteMany({ where: { bookingId: { in: created.bookingIds } } });
        await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        await prisma.$disconnect();
    });

    it('refuses a second leg at the same position in an itinerary', async () => {
        // What made the one-off backfill safe to re-run, and what keeps an
        // itinerary's order unambiguous.
        const flight = await createFlight(`SEQUENCE-UNIQUE-${Date.now()}`);
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: flight.id }] } },
        });
        created.bookingIds.push(booking.id);

        await expect(prisma.itineraryLeg.create({
            data: { bookingId: booking.id, sequence: 1, flightId: flight.id },
        })).rejects.toThrow();
    });

    it('refuses a leg ordered below one', async () => {
        const flight = await createFlight(`SEQUENCE-${Date.now()}`);
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({ data: {} });
        created.bookingIds.push(booking.id);

        await expect(prisma.itineraryLeg.create({
            data: { bookingId: booking.id, sequence: 0, flightId: flight.id },
        })).rejects.toThrow();
    });

    it('removes its legs when a booking is deleted', async () => {
        const flight = await createFlight(`CASCADE-${Date.now()}`);
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: flight.id }] } },
        });

        await prisma.booking.delete({ where: { id: booking.id } });

        await expect(prisma.itineraryLeg.findMany({ where: { bookingId: booking.id } }))
            .resolves.toEqual([]);
    });
});
