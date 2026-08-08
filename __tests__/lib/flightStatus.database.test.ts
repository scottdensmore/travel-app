/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
import { prisma } from '@/lib/prisma';
import { flightStatusSchema } from '@/lib/validation';

/**
 * A flight is on time, delayed or cancelled, and the database is what says so.
 *
 * `Flight.status` was `TEXT NOT NULL DEFAULT 'ON_TIME'` with no enum and no
 * check constraint, so the three-status rule lived only in `flightStatusSchema`
 * at the request boundary. A status written any other way would be filtered on
 * by search, rendered on the status board, and shown to a customer checking
 * whether their flight is running (#73).
 */
const created = { flightIds: [] as number[] };

async function createFlight(status?: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `FS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date('2028-06-01T08:00:00Z'),
            priceCents: 35_000,
            economyRows: 20,
            premiumEconomyRows: 4,
            businessRows: 3,
            firstClassRows: 3,
            seatPattern: 'ABC-DEF',
            ...(status === undefined ? {} : { status: status as 'ON_TIME' }),
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.$disconnect();
});

describe('flight status', () => {
    it('refuses a status that does not exist, whatever wrote it', async () => {
        const flight = await createFlight();

        // Raw SQL on purpose: the point is that the column refuses this, not
        // that a Zod schema upstream would have.
        await expect(prisma.$executeRawUnsafe(
            `UPDATE "Flight" SET "status" = 'DIVERTED' WHERE "id" = $1`,
            flight.id,
        )).rejects.toThrow(/invalid input value for enum/);
    });

    it('holds exactly the three labels, in the database itself', async () => {
        const labels = await prisma.$queryRaw<Array<{ label: string }>>`
            SELECT e.enumlabel AS label
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'FlightStatus'
            ORDER BY e.enumsortorder
        `;

        expect(labels.map(row => row.label)).toEqual(['ON_TIME', 'DELAYED', 'CANCELLED']);
    });

    it('still defaults a new flight to on time', async () => {
        // Retyping the column means dropping the default and putting it back,
        // so it is the part of the migration most easily lost.
        //
        // Asserted against the catalog and through raw SQL, because Prisma
        // materialises `@default(ON_TIME)` client-side: `flight.create()` sends
        // the value explicitly and so passes happily against a column with no
        // default at all.
        const [column] = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
            SELECT column_default
            FROM information_schema.columns
            WHERE table_name = 'Flight' AND column_name = 'status'
        `;
        expect(column.column_default).toBe(`'ON_TIME'::"FlightStatus"`);

        const flightNumber = `FS-DEFAULT-${Date.now()}`;
        await prisma.$executeRawUnsafe(
            `INSERT INTO "Flight" ("flightNumber", "airline",
                                   "fromAirportCode", "toAirportCode", "departureDate", "priceCents")
             VALUES ($1, 'Mona Airways', 'SEA', 'DTW', $2, 35000)`,
            flightNumber, new Date('2028-06-02T08:00:00Z'),
        );
        const inserted = await prisma.flight.findFirstOrThrow({ where: { flightNumber } });
        created.flightIds.push(inserted.id);

        expect(inserted.status).toBe('ON_TIME');
    });

    it('accepts every status the airline can set', async () => {
        for (const status of flightStatusSchema.options) {
            const flight = await createFlight(status);
            expect(flight.status).toBe(status);
        }
    });
});
