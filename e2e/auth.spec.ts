import { test, expect } from '@playwright/test';

test.describe('Authentication Journey', () => {
  const uniqueEmail = `test-${Date.now()}@example.com`;
  const name = 'Test User';
  const password = 'Password123!';

  test('User can register a new account', async ({ page }) => {
    // Navigate to signup
    await page.goto('/signup');

    // Verify page content
    await expect(page.locator('h1')).toContainText('Create an account');

    // Fill registration form
    await page.fill('#name', name);
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', password);

    // Submit form
    await page.click('button:has-text("Create account")');

    // Verify redirect to homepage and auto login (Sign Out button is visible)
    await expect(page).toHaveURL('/');
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
  });

  test('User can log out and log in again', async ({ page }) => {
    const loginEmail = `login-test-${Date.now()}@example.com`;

    // Register a user specifically for this test to isolate state
    await page.goto('/signup');
    await page.fill('#name', name);
    await page.fill('#email', loginEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page).toHaveURL('/');

    // Click logout
    await page.click('button:has-text("Sign Out")');
    await expect(page.locator('a:has-text("Sign In")')).toBeVisible();

    // Log in again
    await page.goto('/login');
    await page.fill('#email', loginEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Sign In with Email")');
    await expect(page).toHaveURL('/');
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();

    // Click logout to clean up state
    await page.click('button:has-text("Sign Out")');
    await expect(page.locator('a:has-text("Sign In")')).toBeVisible();
  });
});
