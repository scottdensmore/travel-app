/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { clearPreviousRunBookings } from '@/e2e/global-setup';
import playwrightConfig from '@/playwright.config';

/**
 * A Playwright run starts from a known database, and against a server it
 * started itself.
 *
 * Both were false. The suite booked seat 11A and never released it, so three
 * specs failed on that database from the first run onwards (#173). And
 * `reuseExistingServer` borrowed whatever was on the port, so a stale server
 * made a healthy branch look broken — and could equally make a broken one look
 * healthy (#196).
 *
 * Note that `clearPreviousRunBookings` is deliberately unscoped, because that
 * is its job. This suite therefore deletes every booking in the development
 * database when it runs, exactly as a Playwright run does.
 */
const created = { flightIds: [] as number[], userIds: [] as string[] };

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('the state a Playwright run starts from', () => {
    it('clears a previous run\'s booking, and the seats it held', async () => {
        const flight = await prisma.flight.create({
            data: {
                flightNumber: `ISO-${randomUUID().slice(0, 8)}`,
                airline: 'Mona Airways',
                ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
                departureDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
                priceCents: 35_000,
            },
        });
        created.flightIds.push(flight.id);

        const user = await prisma.user.create({
            data: { id: `iso-${randomUUID()}`, email: `iso-${randomUUID()}@example.com` },
        });
        created.userIds.push(user.id);

        const booking = await prisma.booking.create({
            data: {
                userId: user.id,
                status: 'CONFIRMED',
                legs: { create: [{ sequence: 1, flightId: flight.id }] },
            },
        });
        await prisma.notification.create({
            data: { userId: user.id, title: 'Stale', message: 'From a previous run', type: 'SYSTEM' },
        });

        // Counted before, so what survives is measured rather than assumed. A
        // bare `count() > 0` afterwards is satisfied by the fixture this test
        // created itself (#155).
        const seeded = {
            flights: await prisma.flight.count(),
            airports: await prisma.airport.count(),
            schedules: await prisma.flightSchedule.count(),
        };

        // The function `e2e/global-setup.ts` runs, not a local imitation of it:
        // an imitation stays green when the real one stops being called.
        await clearPreviousRunBookings();

        expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();
        // The leg is what holds a seat, so it has to go with the booking.
        expect(await prisma.itineraryLeg.count({ where: { flightId: flight.id } })).toBe(0);
        expect(await prisma.seatAssignment.count({ where: { flightId: flight.id } })).toBe(0);

        // And the inventory the next run needs has to stay, to the row.
        expect(await prisma.flight.count()).toBe(seeded.flights);
        expect(await prisma.airport.count()).toBe(seeded.airports);
        expect(await prisma.flightSchedule.count()).toBe(seeded.schedules);

        // Notifications and accounts are left alone on purpose: the seed
        // creates neither, so every row belongs to a previous run or to whoever
        // is developing here, and this cannot tell them apart.
        expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
        expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    });

    it('starts its own server rather than borrowing one', () => {
        // Asserted against the loaded config rather than the file's text: a
        // regression that reintroduces reuse conditionally would not change the
        // one line a source-text check can pin (#196).
        const webServer = playwrightConfig.webServer as { reuseExistingServer?: boolean };

        expect(webServer.reuseExistingServer).toBe(false);
    });
});
