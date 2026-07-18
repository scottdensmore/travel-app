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
});
