/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { searchFlightsAction } from '@/app/actions';
import { airportCodesForRoute } from '@/lib/airports';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

/**
 * Where a flight goes comes from the airports it references (#73).
 *
 * Until the columns were dropped this suite proved *which of two sources* a read
 * path used, by writing a flight whose `from`/`to` contradicted its airports.
 * There is one source now, so that question is unaskable and the contradiction
 * is gone with it. What remains worth asserting is that the route survives the
 * trip: search narrows by the airport codes, and the labels come back resolved.
 *
 * Rio → Miami is deliberate. The seed flies Miami → Rio and not the reverse, so
 * no other row can satisfy these assertions on the fixture's behalf — which is
 * what the disagreeing columns used to guarantee.
 */
const ORIGIN = 'Rio de Janeiro, Brazil';
const DESTINATION = 'Miami, USA';

/** A place no airport answers to, for the branches that must return nothing. */
const UNKNOWN_ORIGIN = 'Nowhere, Atlantis';
const UNKNOWN_DESTINATION = 'Elsewhere, Atlantis';
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
            ...airportCodesForRoute(ORIGIN, DESTINATION),
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
    it('finds a flight by the airports it references', async () => {
        const result = await searchFlightsAction(ORIGIN, DESTINATION, DEPARTURE_DATE);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        expect(result.flights.map((flight) => flight.flightNumber)).toContain(flightNumber);
    });

    it('resolves the route back to the labels those airports carry', async () => {
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
        const result = await searchFlightsAction(UNKNOWN_ORIGIN, UNKNOWN_DESTINATION);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        expect(result.flights).toHaveLength(0);
    });

    it('returns nothing for a place no airport answers to, on a date', async () => {
        const result = await searchFlightsAction(UNKNOWN_ORIGIN, UNKNOWN_DESTINATION, DEPARTURE_DATE);

        if ('ok' in result) throw new Error(`search rejected the input: ${JSON.stringify(result)}`);
        expect(result.flights).toHaveLength(0);
    });
});
