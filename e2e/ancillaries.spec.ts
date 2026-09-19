import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { flightRouteInclude } from '../lib/flightRoute';
import { registerAndSignIn } from './helpers/auth';
import { completeCheckoutPayment } from './helpers/checkoutPayment';
import { fillOneWayFlightSearch } from './helpers/flightSearch';

test.describe('Baggage and Travel Ancillaries Journey', () => {
    const runId = Date.now();
    const password = 'Password123!';
    const createdEmails: string[] = [];

    test.afterAll(async () => {
        // Clean up created users, bookings, payment attempts, and seat holds
        for (const email of createdEmails) {
            try {
                const user = await prisma.user.findUnique({
                    where: { email },
                });
                if (!user) continue;

                await prisma.seatHold.deleteMany({
                    where: { holderKey: { contains: user.id } },
                });

                const bookings = await prisma.booking.findMany({
                    where: { userId: user.id },
                });
                for (const booking of bookings) {
                    await prisma.passengerAncillary.deleteMany({
                        where: { passenger: { bookingId: booking.id } },
                    });
                    await prisma.passenger.deleteMany({
                        where: { bookingId: booking.id },
                    });
                }
                await prisma.booking.deleteMany({
                    where: { userId: user.id },
                });
                await prisma.paymentAttempt.deleteMany({
                    where: { userId: user.id },
                });
                await prisma.user.delete({
                    where: { id: user.id },
                });
            } catch (e) {
                console.error('Cleanup failed in ancillaries.spec.ts:', e);
            }
        }
    });

    test('User books a flight with checked baggage and priority boarding', async ({ page }, testInfo) => {
        const testEmail = `ancillary-${runId}-${testInfo.testId}@example.com`;
        createdEmails.push(testEmail);
        await registerAndSignIn(page, { name: 'Traveler With Bags', email: testEmail, password });

        const targetFlight = await prisma.flight.findFirstOrThrow({
            where: {
                durationMinutes: { not: null },
                departureDate: {
                    gt: new Date(Date.now() + 48 * 60 * 60 * 1000),
                },
            },
            include: flightRouteInclude,
            orderBy: {
                departureDate: 'asc',
            },
        });

        await page.goto('/');

        // 1. Search flight
        await fillOneWayFlightSearch(page, targetFlight);
        await page.click('button:has-text("Find your trip")');
        await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();

        const bookLink = page.locator(`a[href*="/checkout?outbound=${targetFlight.id}"], a:has-text("Book Now"), button:has-text("Select")`).first();
        await expect(bookLink).toBeVisible();
        await bookLink.click();

        // 2. Step 1: Passenger info
        await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
        await page.fill('input[placeholder="John"]', 'Arthur');
        await page.fill('input[placeholder="Doe"]', 'Dent');
        await page.fill('input[type="date"]', '1982-03-11');
        await page.fill('input[placeholder="A00000000"]', 'P12345678');
        await page.click('button:has-text("Select Seats →")');

        // 3. Step 2: Select seat
        await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
        await page.locator('button[title="Select Seat 11A"], button[title^="Select Seat"]').first().click();
        await page.click('button:has-text("Continue to Bags & Extras →")');

        // 4. Step 3: Bags & Extras
        await expect(page.locator('text=Step 3 of 5')).toBeVisible();
        await expect(page.locator('h2:has-text("Bags & Travel Extras")')).toBeVisible();

        const bag1Label = page.locator('label:has-text("1st Checked Bag"), label:has-text("First checked bag")').first();
        await bag1Label.click();

        const priorityLabel = page.locator('label:has-text("Priority Boarding"), label:has-text("Priority boarding")').first();
        await priorityLabel.click();

        await expect(page.locator('text=/Extras [tT]otal: \\$50/')).toBeVisible();
        await page.click('button:has-text("Continue to Review & Payment →")');

        // 5. Step 4: Review & Payment
        await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
        await expect(page.locator('text=/Bags & (travel extras|Extras)/i').first()).toBeVisible();
        await expect(page.locator('text=/Extras total: \\$50/i').first()).toBeVisible();
        await completeCheckoutPayment(page);

        // 6. Step 5: Confirmation
        await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('text=1 Checked Bag')).toBeVisible();
        await expect(page.locator('text=Priority Boarding')).toBeVisible();
    });

    test('Bags & Extras step has zero horizontal overflow across breakpoints', async ({ page }, testInfo) => {
        const testEmail = `ancillary-resp-${runId}-${testInfo.testId}@example.com`;
        createdEmails.push(testEmail);
        await registerAndSignIn(page, { name: 'Traveler Responsive', email: testEmail, password });

        const targetFlight = await prisma.flight.findFirstOrThrow({
            where: {
                durationMinutes: { not: null },
                departureDate: {
                    gt: new Date(Date.now() + 48 * 60 * 60 * 1000),
                },
            },
            include: flightRouteInclude,
            orderBy: {
                departureDate: 'asc',
            },
        });

        await page.goto('/');
        await fillOneWayFlightSearch(page, targetFlight);
        await page.click('button:has-text("Find your trip")');
        await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();

        const bookLink = page.locator(`a[href*="/checkout?outbound=${targetFlight.id}"], a:has-text("Book Now"), button:has-text("Select")`).first();
        await expect(bookLink).toBeVisible();
        await bookLink.click();

        await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
        await page.fill('input[placeholder="John"]', 'Arthur');
        await page.fill('input[placeholder="Doe"]', 'Dent');
        await page.fill('input[type="date"]', '1982-03-11');
        await page.fill('input[placeholder="A00000000"]', 'P12345678');
        await page.click('button:has-text("Select Seats →")');

        await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
        await page.locator('button[title="Select Seat 11A"], button[title^="Select Seat"]').first().click();
        await page.click('button:has-text("Continue to Bags & Extras →")');

        await expect(page.locator('text=Step 3 of 5')).toBeVisible();

        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect.poll(() => page.evaluate(() => ({
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
            }))).toEqual({ clientWidth: width, scrollWidth: width });
        }
    });
});
