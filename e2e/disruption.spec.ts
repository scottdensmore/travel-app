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
import { bookHeldFlight } from './helpers/holdBookingSeats';

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
    return bookHeldFlight(new FlightBookingService(), {
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

/** A round trip: two legs, one traveller seated on each. */
async function bookRoundTripFor(email: string, flightIds: number[], seatNumbers: string[]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return bookHeldFlight(new FlightBookingService(), {
        flightIds,
        userId: user.id,
        passengers: [{
            firstName: 'Ada',
            lastName: 'Lovelace',
            dateOfBirth: '1990-01-01',
            passportNumber: `R${suffix.slice(-7)}`,
            gender: 'Female',
            seatNumbers,
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
    test('shows a comparable replacement without hiding the refund choice', async ({ page }) => {
        const flight = await aFlight(`RPO-${suffix.slice(-6)}`);
        const replacement = await aFlight(`RPN-${suffix.slice(-6)}`);
        await prisma.flight.update({
            where: { id: replacement.id },
            data: { departureDate: new Date(flight.departureDate.getTime() + 2 * 24 * 60 * 60 * 1000) },
        });
        const email = `disrupt-replacement-${suffix}@example.com`;
        await createVerifiedAccount(page, { name: 'Replacement Flyer', email, password });
        const booking = await bookFor(email, flight.id, '5C');
        await prisma.flight.update({ where: { id: flight.id }, data: { status: 'CANCELLED' } });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });

        await page.setViewportSize({ width: 390, height: 844 });
        await signInWithCredentials(page, { email, password });
        await page.goto('/profile');

        const preview = page.getByRole('region', {
            name: `Replacement flights within 3 days for booking ${booking.id}`,
        });
        await expect(preview).toBeVisible();
        await expect(preview.getByRole('listitem').filter({ hasText: replacement.flightNumber }))
            .toContainText('Seattle, USA → Detroit, USA');
        await expect(preview).toContainText('Your original fare is protected.');
        await expect(preview).toContainText('cancel for a full refund');
        await expect(page.getByTestId(`booking-row-${booking.id}`)
            .getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth))
            .toBe(await page.evaluate(() => document.documentElement.clientWidth));
    });

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

        // The whole `CellLabel` design rests on the header row still being
        // read: the captions in each cell are `aria-hidden`, so if the headers
        // ever went away a booking would become a column of programmatically
        // unlabelled strings. `thead` is moved off-screen by clip rather than
        // hidden, and swapping that for `display: none` -- a one-line edit
        // someone tidying CSS would make -- empties this and nothing else
        // notices, because jsdom has no CSS.
        await expect(
            page.getByRole('region', { name: 'Your bookings' }).getByRole('columnheader'),
        ).toHaveCount(6);

        // Said once now. #229 answered this with a second copy beside the
        // flight number, because the Status column sat past the right edge of a
        // scrolling region; the narrow layout stacks the cells instead (#240),
        // so the column itself is on screen and the duplicate is gone.
        const status = page.getByTestId(`booking-status-${booking.id}`);
        await expect(status).toBeVisible();
        await expect(status).toContainText(`${flight.flightNumber} cancelled by airline`);

        // Visible without scrolling sideways, which it was not before.
        const box = (await status.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);

        // Cleanup is `afterAll`'s: deleting the account here detaches the
        // booking (userId is SET NULL), and then nothing matches it by email.
    });

    test('can take the refund it offers without scrolling sideways', async ({ page }) => {
        // #229 made the disruption visible; the action stayed 173px past the
        // right edge, so the customer could read that the airline cancelled
        // their flight and not act on it (#240). Being told and being able to
        // respond are separate outcomes and this is the second one.
        const flight = await aFlight(`ACT-${suffix.slice(-6)}`);
        const email = `disrupt-act-${suffix}@example.com`;
        await createVerifiedAccount(page, { name: 'Acting Flyer', email, password });
        const booking = await bookFor(email, flight.id, '5B');
        await prisma.flight.update({ where: { id: flight.id }, data: { status: 'CANCELLED' } });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });

        await page.setViewportSize({ width: 390, height: 844 });
        await signInWithCredentials(page, { email, password });
        await page.goto('/profile');

        // Playwright's role selector skips anything `display: none`, so this is
        // whichever layout the viewport actually chose.
        const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
        await expect(cancel).toBeVisible();

        const box = (await cancel.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);

        // Reachable is not the same as usable: a button inside a sideways
        // scroller can sit in the viewport and still be clipped by an ancestor,
        // and Playwright's own actionability check would scroll it into view
        // before clicking, hiding exactly the defect this test is about. Taking
        // the refund through to the recorded outcome is the claim that matters.
        page.once('dialog', dialog => dialog.accept());
        await cancel.click();

        await expect(page.getByTestId(`booking-status-${booking.id}`)).toContainText('Cancelled');
        const refunded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(refunded.status).toBe('CANCELLED');
    });

    test('leaves no width between the stacked layout and a table that fits', async ({ page }) => {
        // The first attempt stacked below 640px, and the table needs 590 inside
        // a region narrower than the viewport -- so 641-699px kept the sideways
        // scroll the change exists to remove. At 667, an iPhone SE in landscape
        // or a window snapped to half a 1366 laptop, Cancel rendered clipped
        // mid-word as "Ca". A breakpoint under the table's natural width
        // relocates the overflow rather than removing it.
        const flight = await aFlight(`BND-${suffix.slice(-6)}`);
        const email = `disrupt-band-${suffix}@example.com`;
        await createVerifiedAccount(page, { name: 'Band Flyer', email, password });
        const booking = await bookFor(email, flight.id, '4A');
        await prisma.flight.update({ where: { id: flight.id }, data: { status: 'CANCELLED' } });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });

        await signInWithCredentials(page, { email, password });

        // 320 and 390 are here because the two tests above measure the Cancel
        // button against the *viewport*, which is the blind spot that let the
        // 667px case survive: a region-level overflow at phone width would slip
        // past both of them too.
        const stacked = [320, 390, 641, 667, 700, 767];

        for (const width of [...stacked, 768, 1024]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/profile');
            await page.getByTestId(`booking-row-${booking.id}`).waitFor();

            // Measured against the scrolling region, not the viewport. The
            // first version of this test asked whether the button was inside
            // the window and passed with the defect fully present: at 667 the
            // button ends at x=643 -- inside a 667px window -- while the region
            // clipping it ends at 614. The page never overflows either, because
            // the region keeps its scroll to itself. Reverting the breakpoint
            // to 640 left this green.
            const measured = await page.evaluate(() => {
                const region = document.querySelector<HTMLElement>(
                    '[role="region"][aria-label="Your bookings"]',
                )!;
                return {
                    hidden: region.scrollWidth - region.clientWidth,
                    reachable: region.getAttribute('tabindex') === '0',
                };
            });

            if (stacked.includes(width)) {
                // Stacked: nothing may sit behind a sideways scroll at all.
                expect(measured.hidden, `content is hidden sideways at ${width}px`).toBe(0);
            } else {
                // Above the breakpoint the table may still outgrow a small
                // laptop -- the design says so -- but then it has to be
                // reachable. Asserting no overflow here would fail on a longer
                // airline name with nothing actually wrong.
                expect(
                    measured.hidden === 0 || measured.reachable,
                    `at ${width}px the table hides ${measured.hidden}px with no way to scroll to it`,
                ).toBe(true);
            }
        }
    });

    test('stacks a round trip in the order a card should read', async ({ page }) => {
        // `rowSpan` stops meaning anything once rows are blocks, so the
        // booking-level cells -- authored inside the first leg's row because
        // that is what a table needs -- landed mid-card. A round trip printed
        // "MA404 cancelled by airline" above a block naming its *outbound*,
        // with the cancelled leg trailing below the buttons.
        const outbound = await aFlight(`ORD-${suffix.slice(-6)}`);
        const ret = await aFlight(`RTN-${suffix.slice(-6)}`);
        const email = `disrupt-order-${suffix}@example.com`;
        await createVerifiedAccount(page, { name: 'Order Flyer', email, password });
        const booking = await bookRoundTripFor(email, [outbound.id, ret.id], ['3A', '3B']);
        await prisma.flight.update({ where: { id: ret.id }, data: { status: 'CANCELLED' } });
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });

        await page.setViewportSize({ width: 390, height: 844 });
        await signInWithCredentials(page, { email, password });
        await page.goto('/profile');

        const order = await page.evaluate((id: number) => {
            const card = document.querySelector(`[data-testid="booking-row-${id}"]`)!;
            return Array.from(card.querySelectorAll('td'))
                .filter(cell => (cell.textContent || '').trim())
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
                .map(cell => cell.getAttribute('data-label') ?? 'Actions');
        }, booking.id);

        // Both legs, then the price, what happened, replacement choices, and
        // what can be done about it.
        expect(order).toEqual([
            'Flight', 'Route', 'Departure',
            'Flight', 'Route', 'Departure',
            'Price', 'Status', 'Replacement flights', 'Actions',
        ]);

        // The cancelled leg is named above the action, not below it. Measured
        // from the cells: a row is `display: contents` here and has no box of
        // its own, so asking the `<tr>` for one silently answers about
        // something else.
        const [lastFlightTop, statusTop] = await page.evaluate((id: number) => {
            const card = document.querySelector(`[data-testid="booking-row-${id}"]`)!;
            const flights = Array.from(card.querySelectorAll('td[data-label="Flight"]'));
            const status = card.querySelector(`[data-testid="booking-status-${id}"]`)!;
            return [
                flights[flights.length - 1].getBoundingClientRect().top,
                status.getBoundingClientRect().top,
            ];
        }, booking.id);

        expect(lastFlightTop).toBeLessThan(statusTop);
    });
});
