import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { airportCodesForRoute } from '../lib/airports';

test.describe('Scheduled flight phases', () => {
  const prefix = `phase-${Date.now()}`;

  test.afterAll(async () => {
    await prisma.flight.deleteMany({
      where: { flightNumber: { startsWith: prefix } },
    });
  });

  test('separates upcoming, departed, arrived, delayed, and cancelled flights', async ({ page }) => {
    const now = Date.now();
    const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
    const flights = [
      {
        flightNumber: `${prefix}-upcoming`,
        departureDate: new Date(now + 6 * 60 * 60_000),
        durationMinutes: 60,
        status: 'ON_TIME' as const,
      },
      {
        flightNumber: `${prefix}-departed`,
        departureDate: new Date(now - 30 * 60_000),
        durationMinutes: 120,
        status: 'ON_TIME' as const,
      },
      {
        flightNumber: `${prefix}-arrived`,
        departureDate: new Date(now - 90 * 60_000),
        durationMinutes: 30,
        status: 'ON_TIME' as const,
      },
      {
        flightNumber: `${prefix}-delayed`,
        departureDate: new Date(now - 90 * 60_000),
        durationMinutes: 30,
        status: 'DELAYED' as const,
      },
      {
        flightNumber: `${prefix}-cancelled`,
        departureDate: new Date(now + 5 * 60 * 60_000),
        durationMinutes: 60,
        status: 'CANCELLED' as const,
      },
    ];

    await prisma.flight.createMany({
      data: flights.map(flight => ({
        ...flight,
        airline: 'Mona Airways',
        ...route,
        priceCents: 35_000,
      })),
    });

    const errors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/flights');
    await expect(page.getByRole('heading', { name: 'Flight Status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live Flight Status' })).toHaveCount(0);
    await page.getByPlaceholder(/Search by flight number/).fill(prefix);

    for (const [suffix, phase] of [
      ['upcoming', 'Upcoming'],
      ['departed', 'Departed'],
      ['arrived', 'Arrived'],
      ['delayed', 'Delayed'],
      ['cancelled', 'Cancelled'],
    ]) {
      const row = page.getByRole('row').filter({ hasText: `${prefix}-${suffix}` });
      await expect(row).toContainText(phase);
    }

    await expect(page.getByText(
      'Scheduled phase and airline-set status for Mona Airways flights.',
    )).toBeVisible();

    const filter = page.getByRole('combobox', {
      name: 'Filter by flight phase or status',
    });
    await expect(filter.getByRole('option')).toHaveText([
      'All Phases / Statuses', 'Upcoming', 'Departed', 'Arrived', 'Delayed', 'Cancelled',
    ]);
    await filter.selectOption('ARRIVED');
    await expect(page.getByRole('status')).toHaveText('1 flight shown');
    await expect(page.getByText(`${prefix}-arrived`)).toBeVisible();
    await expect(page.getByText(`${prefix}-departed`)).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});
