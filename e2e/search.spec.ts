import { expect, test } from '@playwright/test';

test.describe('Flight search', () => {
  test('Default route and date produce an available flight', async ({ page }) => {
    await page.goto('/');

    const departureDate = await page.locator('#depart').inputValue();
    expect(departureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.getByRole('button', { name: 'Find your trip' }).click();

    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book Now' }).first()).toBeVisible();
  });

  test('Date controls reject past departures and invalid return order', async ({ page }) => {
    await page.goto('/');

    const departure = page.getByLabel('Depart');
    const returnDate = page.getByLabel('Return');
    const form = page.locator('form');
    const today = new Date().toISOString().slice(0, 10);
    const latest = new Date(`${today}T00:00:00.000Z`);
    latest.setUTCDate(latest.getUTCDate() + 365);
    const latestString = latest.toISOString().slice(0, 10);
    const beyondLatest = new Date(latest);
    beyondLatest.setUTCDate(beyondLatest.getUTCDate() + 1);
    const beyondLatestString = beyondLatest.toISOString().slice(0, 10);
    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayString = yesterday.toISOString().slice(0, 10);
    const validDeparture = await departure.inputValue();

    await expect(departure).toHaveAttribute('min', today);
    await expect(departure).toHaveAttribute('max', latestString);
    await expect(returnDate).toHaveAttribute('min', validDeparture);
    await expect(returnDate).toHaveAttribute('max', latestString);

    await departure.fill(beyondLatestString);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date cannot be more than 365 days in advance.',
    })).toBeVisible();

    await departure.fill(yesterdayString);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date cannot be in the past.',
    })).toBeVisible();

    await page.getByLabel('One Way').check();
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date cannot be in the past.',
    })).toBeVisible();
    await page.getByLabel('Round Trip').check();

    await departure.fill(validDeparture);
    await returnDate.fill(yesterdayString);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Return date cannot be before departure date.',
    })).toBeVisible();

    await page.getByLabel('One Way').check();
    await expect(returnDate).toBeDisabled();
    await expect(returnDate).toHaveValue('');
    await expect(page.getByRole('alert').filter({
      hasText: 'Return date cannot be before departure date.',
    })).toHaveCount(0);

    await page.getByLabel('Round Trip').check();
    await departure.fill('');
    await returnDate.fill(validDeparture);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date is required when a return date is provided.',
    })).toBeVisible();

    await page.getByLabel('One Way').check();
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date is required when a return date is provided.',
    })).toHaveCount(0);
  });
});
