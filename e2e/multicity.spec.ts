import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';
import { completeCheckoutPayment } from './helpers/checkoutPayment';

test.describe('Multi-City Itinerary User Journey', () => {
    const runId = Date.now();
    const password = 'Password123!';
    const createdEmails: string[] = [];
    const createdFlightIds: number[] = [];

    test.beforeAll(async () => {
        // Ensure bookable flights exist for all 3 multi-city legs across candidate dates
        const baseDate = new Date();
        const datesToSeed: Date[] = [];
        for (let offset = 0; offset <= 7; offset++) {
            const d = new Date(baseDate.getTime() + offset * 24 * 60 * 60 * 1000);
            d.setUTCHours(23, 0, 0, 0);
            datesToSeed.push(d);
        }

        const routesToSeed = [
            { from: 'SEA', to: 'DTW', prefix: 'MC1' },
            { from: 'DTW', to: 'JFK', prefix: 'MC2' },
            { from: 'JFK', to: 'SEA', prefix: 'MC3' },
        ];

        for (const r of routesToSeed) {
            for (let i = 0; i < datesToSeed.length; i++) {
                const flight = await prisma.flight.create({
                    data: {
                        flightNumber: `${r.prefix}-${runId}-${i}`,
                        airline: 'Mona Airways',
                        fromAirportCode: r.from,
                        toAirportCode: r.to,
                        departureDate: datesToSeed[i],
                        durationMinutes: 240,
                        priceCents: 35000,
                        status: 'ON_TIME',
                        economyRows: 20,
                        premiumEconomyRows: 4,
                        businessRows: 3,
                        firstClassRows: 3,
                        seatPattern: 'ABC-DEF',
                    },
                });
                createdFlightIds.push(flight.id);
            }
        }
    });

    test.afterAll(async () => {
        for (const email of createdEmails) {
            try {
                const user = await prisma.user.findUnique({ where: { email } });
                if (!user) continue;
                await prisma.seatHold.deleteMany({
                    where: { holderKey: { contains: user.id } },
                });
                const bookings = await prisma.booking.findMany({
                    where: { userId: user.id },
                });
                for (const booking of bookings) {
                    await prisma.passenger.deleteMany({ where: { bookingId: booking.id } });
                }
                await prisma.booking.deleteMany({ where: { userId: user.id } });
                await prisma.paymentAttempt.deleteMany({ where: { userId: user.id } });
                await prisma.user.delete({ where: { id: user.id } });
            } catch (e) {
                console.error('User cleanup error:', e);
            }
        }

        if (createdFlightIds.length > 0) {
            try {
                await prisma.seatHold.deleteMany({
                    where: { flightId: { in: createdFlightIds } },
                });
                await prisma.flight.deleteMany({
                    where: { id: { in: createdFlightIds } },
                });
            } catch (e) {
                console.error('Flight cleanup error:', e);
            }
        }
    });

    test.beforeEach(async ({ page }, testInfo) => {
        const uniqueEmail = `multicity-${runId}-${testInfo.testId}@example.com`;
        createdEmails.push(uniqueEmail);
        await createVerifiedAccount(page, { name: 'MultiCity Traveler', email: uniqueEmail, password });
        await signInWithCredentials(page, { email: uniqueEmail, password });
    });

    test('User can search, sequentially select 3 legs, choose seats, and book a multi-city itinerary', async ({ page }) => {
        await page.goto('/');

        // 1. Switch to Multi-city
        await page.click('label:has-text("Multi-city")');

        // 2. Add a 3rd flight leg
        await page.click('button:has-text("+ Add flight")');
        await expect(page.locator('text=Flight 3')).toBeVisible();

        // 3. Configure 3 legs: SEA -> DTW, DTW -> JFK, JFK -> SEA
        await page.selectOption('select[data-testid="leg-0-from"]', 'Seattle, USA');
        await page.selectOption('select[data-testid="leg-0-to"]', 'Detroit, USA');
        await page.selectOption('select[data-testid="leg-1-to"]', 'New York, USA');
        await page.selectOption('select[data-testid="leg-2-to"]', 'Seattle, USA');

        // 4. Submit search
        await page.click('button:has-text("Find your trip")');

        // 5. Select Flight 1
        await expect(page.locator('text=Step 1 of 3')).toBeVisible();
        await page.click('[data-testid="select-flight-btn"] >> nth=0');

        // 6. Select Flight 2
        await expect(page.locator('text=Step 2 of 3')).toBeVisible();
        await page.click('[data-testid="select-flight-btn"] >> nth=0');

        // 7. Select Flight 3
        await expect(page.locator('text=Step 3 of 3')).toBeVisible();
        await page.click('[data-testid="select-flight-btn"] >> nth=0');

        // 8. Proceed to checkout
        await page.click('a:has-text("Review & Book Itinerary")');
        await expect(page).toHaveURL(/\/checkout\?flights=/);

        // 9. Enter passenger details
        await page.fill('input[placeholder="John"]', 'Alice');
        await page.fill('input[placeholder="Doe"]', 'Smith');
        await page.fill('input[type="date"]', '1992-05-15');
        await page.fill('input[placeholder="A00000000"]', 'US9876543');
        await page.click('button:has-text("Select Seats →")');

        // 10. Select seats for all 3 legs in wizard
        await expect(page.locator('button[title="Select Seat 11A"]').first()).toBeVisible();
        await page.locator('button[title="Select Seat 11A"]').first().click();

        // Leg 2 tab
        await page.click('button:has-text("Flight 2")');
        await page.locator('button[title="Select Seat 11B"]').first().click();

        // Leg 3 tab
        await page.click('button:has-text("Flight 3")');
        await page.locator('button[title="Select Seat 11C"]').first().click();

        await page.click('button:has-text("Review Booking →")');
        await completeCheckoutPayment(page);

        // 11. Verify Confirmation & Profile
        await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 15_000 });
        await page.goto('/profile');
        const bookingRow = page.locator('[data-testid^="booking-row-"]').first();
        await expect(bookingRow).toBeVisible();
        await expect(bookingRow).toContainText('Seattle, USA → Detroit, USA');
        await expect(bookingRow).toContainText('Detroit, USA → New York, USA');
        await expect(bookingRow).toContainText('New York, USA → Seattle, USA');
        await expect(bookingRow).toContainText('Alice (Seat 11A)');
        await expect(bookingRow).toContainText('Alice (Seat 11B)');
        await expect(bookingRow).toContainText('Alice (Seat 11C)');
        await expect(bookingRow).toContainText('MA101');
        await expect(bookingRow).toContainText('Mona Airways');
    });

    test('Multi-city controls remain responsive at 320px, 390px, 768px, and 1280px widths', async ({ page }) => {
        await page.goto('/');
        await page.click('label:has-text("Multi-city")');

        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 800 });

            const box = await page.locator('#flight-search-form').boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);

            await expect.poll(() => page.evaluate(() => ({
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
            }))).toEqual({ clientWidth: width, scrollWidth: width });
        }
    });
});
