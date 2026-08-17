/** @jest-environment node */
import React from 'react';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { airportCodesForRoute } from '@/lib/airports';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/navigation', () => ({
    notFound: () => { throw new Error('notFound'); },
    redirect: () => { throw new Error('redirect'); },
}));

import CheckoutPage from '@/app/checkout/page';
import ProfilePage from '@/app/profile/page';
import AdminPage from '@/app/admin/page';
import AdminFlightsPage from '@/app/admin/flights/page';
import FlightsPage from '@/app/flights/page';

/**
 * Every page renders the route from the airports the flight references (#73).
 *
 * This suite was built to answer "which of two sources did you read", because
 * the columns and the airports held identical text and five read paths could be
 * reverted with the whole suite green. Dropping the columns settles that
 * question permanently, so what it guards now is the resolution itself: a page
 * that forgets to ask for the relation gets `undefined`, and one that maps it
 * wrongly gets the route backwards.
 *
 * Rio -> Miami keeps the assertions attributable. The seed flies Miami -> Rio
 * and not the reverse, so no other row can satisfy them on the fixture's behalf.
 *
 * These pages are async server components. Rather than render them, the tree
 * they return is walked for every string it would show and every prop it hands
 * a client component -- so a route reaching the browser either way is seen.
 */
const ORIGIN = 'Rio de Janeiro, Brazil';
const DESTINATION = 'Miami, USA';

const mockedGetServerSession = getServerSession as unknown as jest.Mock;

const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };
let flightId: number;
let flightNumber: string;
let userId: string;

beforeAll(async () => {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RTE-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute(ORIGIN, DESTINATION),
            // Inside the seven-day window /admin/flights renders. Outside it,
            // the page never shows this flight and every assertion about it is
            // vacuous, which is what `routeHandedOver` refuses (#155).
            departureDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            durationMinutes: 245,
            priceCents: 41_900,
        },
    });
    flightId = flight.id;
    flightNumber = flight.flightNumber;
    created.flightIds.push(flight.id);

    const user = await prisma.user.create({
        data: { id: `route-render-${randomUUID()}`, email: `route-render-${randomUUID()}@example.com` },
    });
    userId = user.id;
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            status: 'CONFIRMED',
            // No passengers: these pages are being asked where the flight goes,
            // and a passenger would only add encrypted columns to maintain.
            legs: { create: [{ sequence: 1, flightId: flight.id }] },
        },
    });
    created.bookingIds.push(booking.id);
});

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

beforeEach(() => {
    mockedGetServerSession.mockResolvedValue({
        user: { id: userId, role: 'ADMIN', staffMfaVerified: true },
    });
});

/**
 * Everything the browser would end up with: text rendered inline, plus the props
 * of any client component, which cross the boundary serialized.
 */
function renderedStrings(node: unknown, found: string[] = []): string[] {
    if (typeof node === 'string') {
        found.push(node);
        return found;
    }
    if (Array.isArray(node)) {
        for (const child of node) renderedStrings(child, found);
        return found;
    }
    if (node === null || typeof node !== 'object') return found;

    if (React.isValidElement(node)) {
        const { children, ...rest } = node.props as { children?: unknown };
        // A client component is a boundary, not a subtree: what reaches it is
        // its props, so they are collected whole rather than walked into.
        // `memo` and `forwardRef` make the type an object rather than a
        // function, so both count -- otherwise wrapping a component in `memo`
        // would silently drop its props from this walk.
        if (typeof node.type === 'function' || typeof node.type === 'object') found.push(JSON.stringify(rest));
        else renderedStrings(rest, found);

        return renderedStrings(children, found);
    }

    // A plain object: the props of a host element, which reach the browser as
    // surely as its children do. A route leaking through `title`, `alt` or
    // `aria-label` was invisible until this walked them.
    for (const value of Object.values(node)) renderedStrings(value, found);

    return found;
}

async function pageText(page: () => Promise<unknown>): Promise<string> {
    return renderedStrings(await page()).join('\n');
}

/**
 * The fixture's own flight, as the page hands it over.
 *
 * Asserting the route as text -- even keyed as `"from":…,"to":…` -- is satisfied
 * by any other row that happens to name the same pair, and the seed has several:
 * a reversed Detroit->Seattle flight makes a swapped mapping look correct, and
 * /admin/flights ships `FlightSchedule` prose carrying those exact two keys. So
 * the object is found by flight number first, and only then read.
 */
function findFlight(node: unknown, flightNumber: string): Record<string, unknown> | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findFlight(child, flightNumber);
            if (found) return found;
        }
        return null;
    }
    if (node === null || typeof node !== 'object') return null;

    if (React.isValidElement(node)) return findFlight(node.props, flightNumber);

    const record = node as Record<string, unknown>;
    if (record.flightNumber === flightNumber) return record;

    for (const value of Object.values(record)) {
        const found = findFlight(value, flightNumber);
        if (found) return found;
    }
    return null;
}

async function routeHandedOver(page: () => Promise<unknown>) {
    const flight = findFlight(await page(), flightNumber);

    // Not merely "the route is wrong": absent means the page never rendered the
    // fixture at all, and every assertion about it would be vacuous (#155).
    expect(flight).not.toBeNull();
    return flight as Record<string, unknown>;
}

describe('the route a page renders', () => {
    it('comes from the airports on checkout', async () => {
        const checkout = () => CheckoutPage({
            searchParams: Promise.resolve({ outbound: String(flightId) }),
        });

        expect(await routeHandedOver(checkout)).toMatchObject({
            from: ORIGIN,
            to: DESTINATION,
            durationMinutes: 245,
        });
    });

    it('comes from the airports on the profile', async () => {
        expect(await routeHandedOver(() => ProfilePage())).toMatchObject({ from: ORIGIN, to: DESTINATION });
    });

    it('comes from the airports on the admin dashboard', async () => {
        // Recent bookings, capped at five and ordered newest first, so the
        // fixture is on the page. This one renders the route inline rather than
        // handing it to a client component, so it is read as text -- and the
        // arrow pins the direction the other cases get from the keyed object.
        //
        // Unlike them, this case is attributable only because nothing else is
        // booked on Rio -> Miami. A confirmed booking on that route from
        // another suite would let it pass on the wrong row.
        const text = await pageText(() => AdminPage());

        expect(text).toContain(flightNumber);
        expect(text).toContain(`${ORIGIN} → ${DESTINATION}`);
    });

    it('comes from the airports on the status board', async () => {
        // The only converted read whose other coverage mocks Prisma, and the
        // one asking for the relation inside a `select` rather than an
        // `include` -- so this is where that shape meets a real database.
        expect(await routeHandedOver(() => FlightsPage())).toMatchObject({ from: ORIGIN, to: DESTINATION });
    });

    it('comes from the airports on the admin flights table', async () => {
        expect(await routeHandedOver(() => AdminFlightsPage())).toMatchObject({ from: ORIGIN, to: DESTINATION });
    });
});
