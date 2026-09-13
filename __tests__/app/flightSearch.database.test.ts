/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { searchFlightsAction } from '@/app/actions';
import { airportCodeFor } from '@/lib/airports';
import { flightRouteWhere } from '@/lib/flightRoute';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

/**
 * Verifies that flight search resolves airport routes directly from the database
 * Airport table (Issue #191).
 *
 * When an airport has an updated or customized label in the database, static
 * AirportData cannot resolve it. With resolveFlightRouteWhere, search queries the
 * database Airport table directly, ensuring flights are discoverable even when
 * database labels diverge from compiled defaults.
 */
const ORIGINAL_ORIGIN_LABEL = 'Rio de Janeiro, Brazil';
const CUSTOM_ORIGIN_LABEL = 'Rio de Janeiro (Galeao), Brazil';
const DESTINATION_LABEL = 'Miami, USA';

const DEPARTURE_DATE = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const created = { flightIds: [] as number[] };
let flightNumber: string;

beforeAll(async () => {
    // Update the database airport label for GIG to a custom label not in AirportData
    await prisma.airport.update({
        where: { iataCode: 'GIG' },
        data: { label: CUSTOM_ORIGIN_LABEL },
    });

    const flight = await prisma.flight.create({
        data: {
            flightNumber: `SRCH-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            fromAirportCode: 'GIG',
            toAirportCode: 'MIA',
            departureDate: new Date(`${DEPARTURE_DATE}T12:00:00Z`),
            priceCents: 45_000,
        },
    });
    created.flightIds.push(flight.id);
    flightNumber = flight.flightNumber;
});

afterAll(async () => {
    try {
        if (created.flightIds.length > 0) {
            await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        }
    } finally {
        // Restore original label to keep database consistent for other suites
        await prisma.airport.update({
            where: { iataCode: 'GIG' },
            data: { label: ORIGINAL_ORIGIN_LABEL },
        });
        await prisma.$disconnect();
    }
});

describe('searching flights with database airport labels', () => {
    it('confirms the custom label is not known to static lookup', () => {
        expect(airportCodeFor(CUSTOM_ORIGIN_LABEL)).toBeNull();
        expect(flightRouteWhere(CUSTOM_ORIGIN_LABEL, DESTINATION_LABEL)).toBeNull();
    });

    it('finds a flight when querying with a customized database airport label', async () => {
        const result = await searchFlightsAction(
            CUSTOM_ORIGIN_LABEL,
            DESTINATION_LABEL,
            DEPARTURE_DATE,
        );

        if ('ok' in result) {
            throw new Error(`Search action rejected input: ${JSON.stringify(result)}`);
        }

        const foundFlight = result.flights.find(
            (flight) => flight.flightNumber === flightNumber,
        );

        expect(foundFlight).toBeDefined();
        expect(foundFlight).toMatchObject({
            flightNumber,
            from: CUSTOM_ORIGIN_LABEL,
            to: DESTINATION_LABEL,
        });
    });

    it('resolves both directions of a round-trip search against database airport labels', async () => {
        const returnDate = new Date(Date.now() + 205 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const returnFlight = await prisma.flight.create({
            data: {
                flightNumber: `RTN-${randomUUID().slice(0, 8)}`,
                airline: 'Mona Airways',
                fromAirportCode: 'MIA',
                toAirportCode: 'GIG',
                departureDate: new Date(`${returnDate}T15:00:00Z`),
                priceCents: 45_000,
            },
        });
        created.flightIds.push(returnFlight.id);

        const result = await searchFlightsAction(
            CUSTOM_ORIGIN_LABEL,
            DESTINATION_LABEL,
            DEPARTURE_DATE,
            returnDate,
        );

        if ('ok' in result) {
            throw new Error(`Search action rejected input: ${JSON.stringify(result)}`);
        }

        expect(result.flights.map((f) => f.flightNumber)).toContain(flightNumber);
        expect(result.inbound).not.toBeNull();
        if (result.inbound && result.inbound.status === 'ok') {
            expect(result.inbound.flights.map((f) => f.flightNumber)).toContain(returnFlight.flightNumber);
            const foundInbound = result.inbound.flights.find(
                (f) => f.flightNumber === returnFlight.flightNumber,
            );
            expect(foundInbound).toMatchObject({
                from: DESTINATION_LABEL,
                to: CUSTOM_ORIGIN_LABEL,
            });
        } else {
            throw new Error('Inbound search was not ok');
        }
    });
});
