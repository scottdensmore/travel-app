import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/prisma';
import { airportCodesForRoute } from '../lib/airports';
import { CHECK_IN_OPENS_HOURS } from '../lib/checkInPolicy';
import FlightBookingService from '../lib/FlightBookingService';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';
import { bookHeldFlight } from './helpers/holdBookingSeats';

loadEnvConfig(process.cwd());

/**
 * The check-in journey #77 asks for, in a browser.
 *
 * A round trip is the case worth driving: the two legs are in different states
 * at the same instant -- the outbound inside its window, the return days from
 * opening -- so a page that answered per booking rather than per leg would be
 * wrong about one of them while looking right about the other. That is exactly
 * the class of defect this application has shipped before (#137, #253), and it
 * is invisible to a one-leg fixture.
 */
const suffix = `${Date.now()}`;
const customerEmail = `checkin-customer-${suffix}@example.com`;
const strangerEmail = `checkin-stranger-${suffix}@example.com`;
// A second owner, so the scoping test does not depend on the first test having
// run: a spec whose fixture is another test's side effect fails for the wrong
// reason the moment that test is skipped or filtered out.
const otherOwnerEmail = `checkin-other-${suffix}@example.com`;
const password = 'Password123!';

const created = { flightIds: [] as number[] };

const HOUR = 60 * 60 * 1000;

test.afterAll(async () => {
    // Each spec deletes what it created: `global-setup` cannot tell this run's
    // account from a developer's, so the teardown's snapshot comparison is the
    // only thing that catches a leak and it needs this to have run (#213).
    await prisma.booking.deleteMany({
        where: { user: { email: { contains: `-${suffix}@example.com` } } },
    });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({
        where: { email: { contains: `-${suffix}@example.com` } },
    });
});

async function aFlight(flightNumber: string, hoursFromNow: number, route: [string, string]) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber,
            airline: 'Mona Airways',
            ...airportCodesForRoute(route[0], route[1]),
            departureDate: new Date(Date.now() + hoursFromNow * HOUR),
            durationMinutes: 240,
            priceCents: 30_000,
            // All economy, so the seat numbers below are unambiguous: under the
            // default layout the low rows are premium cabins.
            firstClassRows: 0,
            businessRows: 0,
            premiumEconomyRows: 0,
            economyRows: 5,
            seatPattern: 'AB-CD',
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function bookFor(
    email: string,
    flightIds: number[],
    seatNumbers: string[],
    travellers: string[] = ['Ada'],
) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return bookHeldFlight(new FlightBookingService(), {
        flightIds,
        userId: user.id,
        passengers: travellers.map((firstName, index) => ({
            firstName,
            lastName: 'Lovelace',
            dateOfBirth: '1990-01-01',
            passportNumber: `C${suffix.slice(-6)}${index}`,
            gender: 'Female',
            // One seat per leg per traveller, offset so two travellers never
            // request the same seat on a leg.
            seatNumbers: seatNumbers.map(seat => `${seat[0]}${String.fromCharCode(seat.charCodeAt(1) + index)}`),
            cabinClass: 'ECONOMY' as const,
        })),
        idempotencyKey: randomUUID(),
    });
}

test.describe('Check-in journey', () => {
    test('checks in the leg whose window is open and leaves the return for later', async ({ page }) => {
        await createVerifiedAccount(page, { name: 'Check In', email: customerEmail, password });
        const outbound = await aFlight(`CI1-${suffix.slice(-6)}`, 5, ['Seattle, USA', 'Detroit, USA']);
        const inbound = await aFlight(
            `CI2-${suffix.slice(-6)}`,
            CHECK_IN_OPENS_HOURS + 72,
            ['Detroit, USA', 'Seattle, USA'],
        );
        await bookFor(customerEmail, [outbound.id, inbound.id], ['1A', '1A'], ['Ada', 'Grace']);

        await signInWithCredentials(page, { email: customerEmail, password });

        // The navigation entry is part of the acceptance criteria: check-in was
        // removed in #70 precisely because it led nowhere.
        await page.getByRole('link', { name: 'Check In' }).click();
        await expect(page).toHaveURL('/checkin');

        const outboundCard = page.getByRole('region', { name: /Departing: Seattle, USA to Detroit, USA/ });
        const returnCard = page.getByRole('region', { name: /Returning: Detroit, USA to Seattle, USA/ });
        await expect(outboundCard).toBeVisible();
        await expect(returnCard).toBeVisible();

        // The return is days from opening, so it must offer no control and say
        // why. One answer for the whole booking would get one of these wrong.
        // Exact: the card also carries "Check-in opens" and "Check-in closes"
        // labels, which a substring match resolves to as well.
        await expect(returnCard.getByText('Check-in not open yet', { exact: true })).toBeVisible();
        await expect(returnCard.getByRole('button', { name: /Check in/ })).toHaveCount(0);
        await expect(returnCard.getByText(/Check-in opens 24 hours before departure/)).toBeVisible();

        await expect(outboundCard.getByText('Check-in open', { exact: true })).toBeVisible();
        await outboundCard.getByRole('button', { name: 'Check in 2 travellers' }).click();

        await expect(outboundCard.getByRole('status')).toContainText('Checked in for Mona Airways');
        // After the refresh the server is the one saying so, so this asserts the
        // stamp reached the database rather than only the browser's state.
        await expect(outboundCard.getByText('Checked in', { exact: true }).first()).toBeVisible();
        await expect(outboundCard.getByRole('button', { name: /Check in/ })).toHaveCount(0);
        // The return is untouched by the outbound's check-in.
        await expect(returnCard.getByText('Check-in not open yet', { exact: true })).toBeVisible();

        const stamps = await prisma.seatAssignment.findMany({
            where: { flightId: { in: [outbound.id, inbound.id] } },
            select: { flightId: true, checkedInAt: true },
        });
        expect(stamps.filter(seat => seat.flightId === outbound.id).every(seat => seat.checkedInAt !== null))
            .toBe(true);
        expect(stamps.filter(seat => seat.flightId === inbound.id).every(seat => seat.checkedInAt === null))
            .toBe(true);
    });

    test('shows another customer nothing of this booking', async ({ page }) => {
        await createVerifiedAccount(page, { name: 'Stranger', email: strangerEmail, password });
        await createVerifiedAccount(page, { name: 'Owner', email: otherOwnerEmail, password });
        const flight = await aFlight(`CI3-${suffix.slice(-6)}`, 5, ['Seattle, USA', 'Detroit, USA']);
        await bookFor(otherOwnerEmail, [flight.id], ['2A']);

        await signInWithCredentials(page, { email: strangerEmail, password });
        await page.goto('/checkin');

        // The query is scoped to the authenticated owner, so a stranger sees the
        // empty state rather than somebody else's confirmation reference.
        await expect(page.getByText(/no flights in the next month/)).toBeVisible();
        await expect(page.getByRole('region')).toHaveCount(0);
    });

    test('does not offer check-in to a visitor who is not signed in', async ({ page }) => {
        await page.goto('/checkin');

        await expect(page.getByRole('link', { name: 'log in' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Check in/ })).toHaveCount(0);
    });
});
