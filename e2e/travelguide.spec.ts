import { test, expect } from '@playwright/test';

test.describe('Travel Guide Journey', () => {
  const uniqueEmail = `guidetest-${Date.now()}@example.com`;
  const name = 'Guide Test User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // Register and login a fresh user to isolate favorites/reviews state
    await page.goto('/signup');
    await page.fill('#name', name);
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page).toHaveURL('/');
  });

  test('User can select a city, write a review, and toggle favorite', async ({ page }) => {
    // Go to travel guide page
    await page.goto('/travelguide');

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
  });
});
