import { test, expect } from '@playwright/test';
import { registerAccount, registerAndSignIn, signInWithCredentials } from './helpers/auth';

test.describe('Authentication Journey', () => {
  const uniqueEmail = `test-${Date.now()}@example.com`;
  const name = 'Test User';
  const password = 'Password123!';

  test('Login and signup remain usable at phone, tablet, and desktop widths', async ({ page }) => {
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/login', '/signup']) {
        await page.goto(path);
        const form = page.locator('form');
        await expect(form).toBeVisible();
        const box = await form.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    }
  });

  test('User can register a new account', async ({ page }) => {
    await registerAccount(page, { name, email: uniqueEmail, password });
    await signInWithCredentials(page, { email: uniqueEmail, password });
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
  });

  test('User can log out and log in again', async ({ page }) => {
    const loginEmail = `login-test-${Date.now()}@example.com`;

    // Register a user specifically for this test to isolate state
    await registerAndSignIn(page, { name, email: loginEmail, password });

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
