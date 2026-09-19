import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { airportCodesForRoute } from '../lib/airports';

test.describe('Public Flight Status Tracker', () => {
    const flightNumber = `FS-${Date.now().toString().slice(-3)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

    test.beforeAll(async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        await prisma.flight.create({
            data: {
                flightNumber,
                airline: 'Mona Airways',
                ...route,
                departureDate: new Date(Date.now() + 25 * 60_000), // 25m out -> BOARDING
                durationMinutes: 240,
                priceCents: 35000,
                status: 'ON_TIME',
                departureTerminal: 'Main',
                departureGate: 'B4',
                arrivalTerminal: 'Evans',
                arrivalGate: 'D12',
            },
        });
    });

    test.afterAll(async () => {
        await prisma.flight.deleteMany({ where: { flightNumber } });
    });

    test('Anonymous visitor searches by flight number and views detailed status card', async ({ page }) => {
        await page.goto('/flight-status');

        // Verify page loads without authentication
        await expect(page.getByRole('heading', { name: /flight status/i })).toBeVisible();

        // Search by flight number
        await page.getByRole('textbox', { name: /flight number/i }).fill(flightNumber);
        await page.getByRole('button', { name: /(check status|search)/i }).click();

        // Verify detailed card displays
        await expect(page.getByText(flightNumber)).toBeVisible();
        await expect(page.getByText(/boarding/i)).toBeVisible();
        await expect(page.getByText(/Gate B4/i)).toBeVisible();
        await expect(page.getByText(/Gate D12/i)).toBeVisible();
    });

    test('Anonymous visitor searches by route and deep links directly via URL', async ({ page }) => {
        // Deep-link directly via URL
        await page.goto(`/flight-status?from=SEA&to=DTW`);

        await expect(page.getByText(flightNumber)).toBeVisible();
    });

    test('Legacy /flights redirects cleanly to /flight-status', async ({ page }) => {
        await page.goto('/flights');
        await expect(page).toHaveURL(/\/flight-status/);
    });

    test('Flight status page has zero horizontal overflow across breakpoints', async ({ page }) => {
        await page.goto(`/flight-status?flight=${flightNumber}`);

        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect.poll(() => page.evaluate(() => ({
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
            }))).toEqual({ clientWidth: width, scrollWidth: width });
        }
    });
});
