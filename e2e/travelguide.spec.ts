import { test, expect } from '@playwright/test';
import { registerAndSignIn } from './helpers/auth';

test.describe('Travel Guide Journey', () => {
  const uniqueEmail = `guidetest-${Date.now()}@example.com`;
  const name = 'Guide Test User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // Register and login a fresh user to isolate favorites/reviews state
    await registerAndSignIn(page, { name, email: uniqueEmail, password });
  });

  test('User can select a city, write a review, and toggle favorite', async ({ page }) => {
    const renderingErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') renderingErrors.push(message.text());
    });
    page.on('pageerror', error => renderingErrors.push(error.message));

    // Go to travel guide page
    await page.goto('/travelguide');

    // Exercise the real SVG map produced by react-simple-maps and D3.
    const newYorkMarker = page.locator('.rsm-marker[data-city="New York"]');
    await expect(newYorkMarker).toBeVisible();
    await newYorkMarker.click();
    await expect(page.locator('.guide-extra.highlight h3')).toContainText('New York');

    // Click on "Detroit, USA" in the sidebar list to make it active
    const cityListItem = page.locator('li h3:has-text("Detroit")').first();
    await expect(cityListItem).toBeVisible();
    await cityListItem.click();

    // Verify highlighted city details sidebar is visible and displays correct header
    const activeSidebar = page.locator('.guide-extra.highlight');
    await expect(activeSidebar).toBeVisible();
    await expect(activeSidebar.locator('h3')).toContainText(/Detroit/i);

    // Write and submit a review
    const reviewText = `Amazing experience here! Reviewed at ${Date.now()}`;
    await activeSidebar.locator('textarea[placeholder="Share your experience..."]').fill(reviewText);
    await activeSidebar.locator('button:has-text("Submit Review")').click();

    // Expect the review text to appear in the reviews list
    const newReviewItem = activeSidebar.locator('li', { hasText: reviewText });
    await expect(newReviewItem).toBeVisible();

    // Toggle favorite state
    const favoriteBtn = activeSidebar.locator('button:has-text("Favorite")');
    await expect(favoriteBtn).toBeVisible();
    await favoriteBtn.click();

    // Verify button text changes to Unfavorite
    const unfavoriteBtn = activeSidebar.locator('button:has-text("Unfavorite")');
    await expect(unfavoriteBtn).toBeVisible();

    expect(renderingErrors).toEqual([]);
  });
});
