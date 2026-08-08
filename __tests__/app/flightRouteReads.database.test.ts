/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { searchFlightsAction } from '@/app/actions';
import { airportCodesForRoute } from '@/lib/airports';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

/**
 * Where a flight goes comes from the airports it references, not from the two
 * text columns beside them (#73).
 *
 * This is what makes dropping `Flight.from` and `Flight.to` a migration rather
 * than a rewrite, so it is asserted against the columns holding something no
 * search would ever match and no customer should ever see. If a read path still
 * depends on them, the flight either fails to come back or comes back naming
 * nowhere — and this fails either way.
 *
 * The columns are still NOT NULL, so they cannot simply be left empty; garbage
 * is the closest a test can get to their absence while they exist.
 */
const WRONG_ORIGIN = 'Nowhere, Atlantis';
const WRONG_DESTINATION = 'Elsewhere, Atlantis';

const ORIGIN = 'Seattle, USA';
const DESTINATION = 'Detroit, USA';
// Inside the booking window the schema enforces, and far enough out that no
// other suite's fixtures share the day.
const DEPARTURE_DATE = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const created = { flightIds: [] as number[] };
let flightNumber: string;

beforeAll(async () => {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RTE-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            // The route it actually flies, said only by the references.
            ...airportCodesForRoute(ORIGIN, DESTINATION),
            // The route the abandoned columns claim.
            from: WRONG_ORIGIN,
            to: WRONG_DESTINATION,
            departureDate: new Date(`${DEPARTURE_DATE}T17:30:00Z`),
            priceCents: 41_900,
        },
    });
    created.flightIds.push(flight.id);
    flightNumber = flight.flightNumber;
});

afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.$disconnect();
});

describe('searching by route', () => {
    it('finds a flight whose airports match, whatever its labels say', async () => {
        const result = await searchFlightsAction(ORIGIN, DESTINATION, DEPARTURE_DATE);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        expect(result.flights.map((flight) => flight.flightNumber)).toContain(flightNumber);
    });

    it('renders the airport it references, not the label stored beside it', async () => {
        const result = await searchFlightsAction(ORIGIN, DESTINATION, DEPARTURE_DATE);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        const found = result.flights.find((flight) => flight.flightNumber === flightNumber);

        expect(found).toBeDefined();
        expect(found).toMatchObject({ from: ORIGIN, to: DESTINATION });
    });

    it('names the airports on a search with no date at all', async () => {
        // Its own query, and its own `include`. Dropping the relation there is
        // a TypeError on every dateless search -- reachable from the form,
        // whose date field is optional -- and the dated cases cannot see it.
        const result = await searchFlightsAction(ORIGIN, DESTINATION);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        const found = result.flights.find((flight) => flight.flightNumber === flightNumber);

        expect(found).toBeDefined();
        expect(found).toMatchObject({ from: ORIGIN, to: DESTINATION });
    });

    it('returns nothing for a place no airport answers to, with no date', async () => {
        // The dateless branch has its own guard, and deleting it left the whole
        // suite green: `where` becomes `null`, which stops filtering by route
        // rather than matching nothing.
        const result = await searchFlightsAction(WRONG_ORIGIN, WRONG_DESTINATION);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        expect(result.flights).toHaveLength(0);
    });

    it('does not find that flight under the labels it stores', async () => {
        // The mirror of the first case, and the one that would still pass if
        // the query had simply been left matching on text.
        const result = await searchFlightsAction(WRONG_ORIGIN, WRONG_DESTINATION, DEPARTURE_DATE);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        expect(result.flights).toHaveLength(0);
    });
});
