import { expect, Page } from '@playwright/test';

export async function registerAccount(
  page: Page,
  account: { name: string; email: string; password: string }
) {
  await page.goto('/signup');
  await page.fill('#name', account.name);
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.click('button:has-text("Create account")');
  await expect(page.locator('form').getByRole('status')).toHaveText(
    'If this address is eligible, you can now sign in with your credentials.'
  );
}

export async function signInWithCredentials(
  page: Page,
  account: { email: string; password: string }
) {
  await page.goto('/login');
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.click('button:has-text("Sign In with Email")');
  await expect(page).toHaveURL('/');
}

export async function registerAndSignIn(
  page: Page,
  account: { name: string; email: string; password: string }
) {
  await registerAccount(page, account);
  await signInWithCredentials(page, account);
}
