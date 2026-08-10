import { test, expect } from '@playwright/test';
import { createVerifiedAccount, registerAndSignIn, signInWithCredentials } from './helpers/auth';
import { prisma } from '../lib/prisma';

test.describe('Authentication Journey', () => {
  const uniqueEmail = `test-${Date.now()}@example.com`;
  // Declared here rather than in the test that uses it so that the cleanup can
  // see it too.
  const loginEmail = `login-test-${Date.now()}@example.com`;
  const name = 'Test User';
  const password = 'Password123!';

  test.afterAll(async () => {
    // Two accounts per run, deleted by nothing: 42 had accumulated. The other
    // specs already do this; this one was missed because it never touched the
    // database directly (#213).
    await prisma.user.deleteMany({ where: { email: { in: [uniqueEmail, loginEmail] } } });
  });

  test('Authentication and recovery remain usable at phone, tablet, and desktop widths', async ({ page }) => {
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of [
        '/login',
        '/signup',
        '/forgot-password',
        '/resend-verification',
        `/reset-password#token=${'a'.repeat(43)}`,
      ]) {
        await page.goto(path);
        const form = page.locator('form');
        await expect(form).toBeVisible();
        const box = await form.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }

      await page.goto(`/verify-email#token=${'a'.repeat(43)}`);
      const verificationPanel = page.getByRole('region', { name: 'Confirm your email' });
      await expect(verificationPanel).toBeVisible();
      const verificationBox = await verificationPanel.boundingBox();
      expect(verificationBox).not.toBeNull();
      expect(verificationBox!.x).toBeGreaterThanOrEqual(0);
      expect(verificationBox!.x + verificationBox!.width).toBeLessThanOrEqual(width);
    }
  });

  test('Missing and malformed recovery tokens fail before showing an action form', async ({ page }) => {
    for (const path of [
      '/verify-email',
      '/verify-email#token=x',
      '/reset-password',
      '/reset-password#token=x',
    ]) {
      await page.goto(path);
      await expect(page.locator('main').getByRole('alert')).toContainText('invalid or expired');
      await expect(page.getByRole('button', { name: /Verify email|Reset password/ })).toHaveCount(0);
      await expect(page.getByText('Mona Airways', { exact: true }).first()).toBeVisible();
    }
  });

  test('User can sign in with a verified account', async ({ page }) => {
    await createVerifiedAccount(page, { name, email: uniqueEmail, password });
    await signInWithCredentials(page, { email: uniqueEmail, password });
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
  });

  test('User can log out and log in again', async ({ page }) => {
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
