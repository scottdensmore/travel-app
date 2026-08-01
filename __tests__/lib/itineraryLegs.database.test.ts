/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

const migrationPath = path.resolve(
    process.cwd(),
    'prisma/migrations/20260801160000_add_itinerary_legs/migration.sql'
);

/** The backfill statement, taken from the migration rather than restated here. */
function backfillStatement(): string {
    const migration = fs.readFileSync(migrationPath, 'utf8');
    const statement = migration
        .split(';')
        // Drop the explanatory comments so a statement starts with its verb.
        .map(part => part
            .split(/\r?\n/)
            .filter(line => !line.trim().startsWith('--'))
            .join('\n')
            .trim())
        .find(part => part.startsWith('INSERT INTO "ItineraryLeg"'));

    if (!statement) throw new Error('Backfill statement not found in the migration.');
    return statement;
}

async function createFlight(flightNumber: string) {
    return prisma.flight.create({
        data: {
            flightNumber,
            airline: 'Gemini Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: new Date(`2027-03-01T08:00:00Z`),
            price: '$350',
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

    it('turns a booking that predates the column into a one-leg itinerary', async () => {
        const flight = await createFlight(`BACKFILL-${Date.now()}`);
        created.flightIds.push(flight.id);

        // A booking shaped the way one looked before legs existed.
        const booking = await prisma.booking.create({ data: { flightId: flight.id } });
        created.bookingIds.push(booking.id);
        await prisma.itineraryLeg.deleteMany({ where: { bookingId: booking.id } });

        await prisma.$executeRawUnsafe(backfillStatement());

        const legs = await prisma.itineraryLeg.findMany({ where: { bookingId: booking.id } });
        expect(legs).toEqual([
            expect.objectContaining({ sequence: 1, flightId: flight.id }),
        ]);
    });

    it('is safe to re-run, because a booking cannot gain a duplicate first leg', async () => {
        const flight = await createFlight(`RERUN-${Date.now()}`);
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({
            data: { flightId: flight.id, legs: { create: [{ sequence: 1, flightId: flight.id }] } },
        });
        created.bookingIds.push(booking.id);

        await expect(prisma.$executeRawUnsafe(backfillStatement())).rejects.toThrow();

        const legs = await prisma.itineraryLeg.findMany({ where: { bookingId: booking.id } });
        expect(legs).toHaveLength(1);
    });

    it('refuses a leg ordered below one', async () => {
        const flight = await createFlight(`SEQUENCE-${Date.now()}`);
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({ data: { flightId: flight.id } });
        created.bookingIds.push(booking.id);

        await expect(prisma.itineraryLeg.create({
            data: { bookingId: booking.id, sequence: 0, flightId: flight.id },
        })).rejects.toThrow();
    });

    it('removes its legs when a booking is deleted', async () => {
        const flight = await createFlight(`CASCADE-${Date.now()}`);
        created.flightIds.push(flight.id);
        const booking = await prisma.booking.create({
            data: { flightId: flight.id, legs: { create: [{ sequence: 1, flightId: flight.id }] } },
        });

        await prisma.booking.delete({ where: { id: booking.id } });

        await expect(prisma.itineraryLeg.findMany({ where: { bookingId: booking.id } }))
            .resolves.toEqual([]);
    });
});
