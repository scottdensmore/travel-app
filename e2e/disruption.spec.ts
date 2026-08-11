import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/prisma';
import { airportCodesForRoute } from '../lib/airports';
import { heldSeats } from '../lib/seatOccupancy';
import FlightBookingService from '../lib/FlightBookingService';
import {
    createStaffTotpCode,
    encryptStaffMfaSecret,
    generateStaffMfaSecret,
} from '../lib/staffMfa';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';

loadEnvConfig(process.cwd());

/**
 * The two journeys #76 is about, in a browser.
 *
 * Everything below this point had unit and database coverage and no browser
 * coverage at all: the existing cancel journey only ever cancels a future
 * flight and never looks at what came back, so neither the refund nor the
 * refusal was exercised end to end, and the disruption path was not exercised
 * at all.
 *
 * These cross staff, customer, database and money in one pass, which is the
 * kind of crossing AGENTS.md asks for a journey test on.
 */
const suffix = `${Date.now()}`;
const customerEmail = `disrupt-customer-${suffix}@example.com`;
const staffEmail = `disrupt-staff-${suffix}@example.com`;
const departedEmail = `disrupt-departed-${suffix}@example.com`;
const flyerEmail = `disrupt-flyer-${suffix}@example.com`;
const password = 'Password123!';
const staffSecret = generateStaffMfaSecret();

const created = { flightIds: [] as number[] };

test.afterAll(async () => {
    await prisma.booking.deleteMany({
        where: { user: { email: { contains: `-${suffix}@example.com` } } },
    });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({
        where: { email: { contains: `-${suffix}@example.com` } },
    });
});

/**
 * A flight five days out: past the 24-hour refund cut-off, and inside the
 * seven-day window the admin board lists, so staff can act on it there.
 */
async function aFlight(flightNumber: string) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            priceCents: 30_000,
            // All economy, so the seat numbers below are unambiguous: under
            // the default layout the low rows are premium cabins.
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

async function bookFor(email: string, flightId: number, seatNumber: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return new FlightBookingService().bookFlight({
        flightIds: [flightId],
        userId: user.id,
        passengers: [{
            firstName: 'Ada',
            lastName: 'Lovelace',
            dateOfBirth: '1990-01-01',
            passportNumber: `P${suffix.slice(-7)}`,
            gender: 'Female',
            seatNumbers: [seatNumber],
            cabinClass: 'ECONOMY',
        }],
        idempotencyKey: randomUUID(),
    });
}

/**
 * The recorded outcome of a booking's most recent status change.
 *
 * Read from the history rather than recomputed, because the history is what
 * #75 will refund against and what an auditor would read.
 */
async function lastChange(bookingId: number) {
    return prisma.bookingStatusChange.findFirstOrThrow({
        where: { bookingId },
        orderBy: { sequence: 'desc' },
    });
}

test.describe('Cancelling a booking yourself', () => {
    test('shows the fare, takes the fee, and records what came back', async ({ page }) => {
        const flight = await aFlight(`SLF-${suffix.slice(-6)}`);
        await createVerifiedAccount(page, { name: 'Self Canceller', email: customerEmail, password });
        const booking = await bookFor(customerEmail, flight.id, '2A');
        await signInWithCredentials(page, { email: customerEmail, password });

        await page.goto('/profile');
        await expect(page.getByText('Ada (Seat 2A)')).toBeVisible();

        const row = page.getByTestId(`booking-row-${booking.id}`);
        page.once('dialog', dialog => dialog.accept());
        await row.getByRole('button', { name: 'Cancel', exact: true }).click();
        // Scoped to the Status column. The status also renders beside the
        // flight number at phone width, so a visibility filter would resolve to
        // both the moment anyone runs this at 390px (#229).
        await expect(page.getByTestId(`booking-status-${booking.id}`)).toContainText('Cancelled');

        // The seat is free again, and the row still says which seat it was --
        // a held count of zero is equally true of the placeholder rename this
        // replaced, so the number has to be read to mean anything (#76).
        expect(await prisma.seatAssignment.count({
            where: heldSeats({ flightId: flight.id, seatNumber: '2A' }),
        })).toBe(0);
        const released = await prisma.seatAssignment.findFirstOrThrow({
            where: { flightId: flight.id },
        });
        expect(released.seatNumber).toBe('2A');
        expect(released.releasedAt).not.toBeNull();
        await expect(page.getByText('Ada (Seat released)')).toBeVisible();

        // Economy, well before the cut-off: a fifth of the fare is kept, and
        // the amount is written down rather than left to be re-derived later.
        const change = await lastChange(booking.id);
        expect(change).toMatchObject({ from: 'CONFIRMED', to: 'CANCELLED', refundCents: 24_000 });
        expect(change.reason).toMatch(/6000 minor units of the booking currency retained/);
    });
});

test.describe('When the airline cancels the flight', () => {
    test('the customer is told, keeps the seat, and can take a full refund', async ({ page }) => {
        // Staff and customer in one journey: the states only make sense
        // together, and the refund the customer receives is decided by what
        // staff did.
        test.slow();

        const flight = await aFlight(`DSR-${suffix.slice(-6)}`);
        // Two people, deliberately. With one account the journey cannot tell
        // "the customer is told" from "whoever pressed the button is told",
        // and a notification addressed to the acting staff member would pass.
        await createVerifiedAccount(page, { name: 'Disrupted Flyer', email: flyerEmail, password });
        await createVerifiedAccount(page, { name: 'Ops Staff', email: staffEmail, password });
        const booking = await bookFor(flyerEmail, flight.id, '3C');

        // Enrolled directly: the enrolment journey is admin.spec.ts's subject,
        // and repeating it here would spend thirty seconds proving nothing new.
        const staff = await prisma.user.findUniqueOrThrow({ where: { email: staffEmail } });
        await prisma.user.update({
            where: { id: staff.id },
            data: {
                role: 'ADMIN',
                staffMfaSecretEncrypted: encryptStaffMfaSecret(staffSecret, staff.id),
                staffMfaEnrolledAt: new Date(),
            },
        });

        await signInWithCredentials(page, {
            email: staffEmail,
            password,
            staffCode: createStaffTotpCode(staffSecret),
        }, '/admin');

        // Staff cancel the flight from the board they actually use.
        await page.goto('/admin/flights');
        const row = page.locator('tr', { hasText: flight.flightNumber }).first();
        await row.locator('select').first().selectOption('CANCELLED');
        await expect(row.locator('select').first()).toHaveValue('CANCELLED');

        // The seat is still the customer's -- that is the whole difference
        // between DISRUPTED and CANCELLED.
        expect(await prisma.seatAssignment.count({
            where: heldSeats({ flightId: flight.id, seatNumber: '3C' }),
        })).toBe(1);

        // Reinstated and cancelled again, still as staff: the reason a staff
        // cancellation is not a one-way door. What the customer sees of the
        // reinstatement is covered in
        // `__tests__/app/flightDisruption.database.test.ts`; switching accounts
        // twice more here would buy a slower test rather than a better one.
        const sameRow = page.locator('tr', { hasText: flight.flightNumber }).first();
        await sameRow.locator('select').first().selectOption('ON_TIME');
        await expect(sameRow.locator('select').first()).toHaveValue('ON_TIME');
        await expect.poll(async () =>
            (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status,
        ).toBe('CONFIRMED');

        await sameRow.locator('select').first().selectOption('CANCELLED');
        await expect(sameRow.locator('select').first()).toHaveValue('CANCELLED');

        // Now the customer, who is a different person from the one who
        // cancelled the flight.
        await page.goto('/profile');
        await page.getByRole('button', { name: 'Sign Out' }).click();
        await signInWithCredentials(page, { email: flyerEmail, password });

        await page.goto('/profile');
        await expect(page.getByTestId(`booking-status-${booking.id}`))
            .toContainText(`${flight.flightNumber} cancelled by airline`);
        await expect(page.getByText(/Your seat is held/)).toBeVisible();

        await expect(page.getByText(/has been cancelled by the airline/)).toHaveCount(0);
        await page.locator('button[aria-label="Toggle notifications"]').click();
        // Two, because the flight was cancelled, put back, and cancelled again
        // -- one per real transition, and none for the repeat of a state it was
        // already in.
        await expect(page.getByText(/has been cancelled by the airline/)).toHaveCount(2);
        // And the reinstatement in between said so plainly. ("operating again"
        // is reserved for a trip still broken by another cancelled leg.)
        await expect(page.getByText(/is now ON TIME/)).toHaveCount(1);

        await page.goto('/profile');
        const disruptedRow = page.getByTestId(`booking-row-${booking.id}`);
        await expect(disruptedRow).toContainText('cancelled by airline');

        let prompt = '';
        page.once('dialog', async dialog => {
            prompt = dialog.message();
            await dialog.accept();
        });
        await disruptedRow.getByRole('button', { name: 'Cancel', exact: true }).click();
        // Scoped to the row, and to the status rather than any text containing
        // the word: "cancelled by airline" also contains "Cancelled".
        await expect(page.getByTestId(`booking-status-${booking.id}`)).toContainText('Cancelled');
        expect(prompt).toMatch(/take a full refund/i);

        // Whole fare back, no fee: the airline caused this, so the fare rules
        // do not apply. An ordinary cancellation of the same booking would
        // have kept 6,000.
        const change = await lastChange(booking.id);
        expect(change).toMatchObject({ from: 'DISRUPTED', to: 'CANCELLED', refundCents: 30_000 });
        expect(change.reason).toMatch(/airline disrupted/i);

        // And the seat is finally released.
        expect(await prisma.seatAssignment.count({
            where: heldSeats({ flightId: flight.id, seatNumber: '3C' }),
        })).toBe(0);
    });
});

test.describe('A booking whose flight has gone', () => {
    test('offers no cancellation, and promises no refund', async ({ page }) => {
        // The server refuses this, and the row must not invite it: a button
        // that can only fail is worse than no button.
        // Its own account: borrowing the one the first journey makes would
        // leave this passing or failing for that journey's reasons.
        const flight = await aFlight(`GON-${suffix.slice(-6)}`);
        await createVerifiedAccount(page, { name: 'Departed Flyer', email: departedEmail, password });
        const booking = await bookFor(departedEmail, flight.id, '4D');
        await prisma.flight.update({
            where: { id: flight.id },
            data: { departureDate: new Date(Date.now() - 60 * 60 * 1000) },
        });

        await signInWithCredentials(page, { email: departedEmail, password });
        await page.goto('/profile');

        const row = page.getByTestId(`booking-row-${booking.id}`);
        await expect(row).toBeVisible();
        await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
        await expect(row.getByText(/full refund/)).toHaveCount(0);
    });
});

test.describe('A disrupted booking on a phone', () => {
    test('says so where the screen can actually show it', async ({ page }) => {
        // The visible premise of #229, and the only place it is proven against
        // real geometry: at 390px the Status column sits past the right edge of
        // a scrolling region, so without the copy beside the flight number a
        // disrupted booking is pixel-identical to a confirmed one. Jest can
        // only assert this with hand-stubbed offsets.
        const flight = await aFlight(`PHN-${suffix.slice(-6)}`);
        const email = `disrupt-phone-${suffix}@example.com`;
        await createVerifiedAccount(page, { name: 'Phone Flyer', email, password });
        const booking = await bookFor(email, flight.id, '5A');
        await prisma.flight.update({ where: { id: flight.id }, data: { status: 'CANCELLED' } });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });

        await page.setViewportSize({ width: 390, height: 844 });
        await signInWithCredentials(page, { email, password });
        await page.goto('/profile');

        const compact = page.getByTestId(`compact-booking-status-${booking.id}`);
        await expect(compact).toBeVisible();
        await expect(compact).toContainText(`${flight.flightNumber} cancelled by airline`);

        // Visible without scrolling sideways, which the Status column is not.
        const box = (await compact.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(390);

        // Cleanup is `afterAll`'s: deleting the account here detaches the
        // booking (userId is SET NULL), and then nothing matches it by email.
    });
});

