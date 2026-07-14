import { expect, Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';

export async function createVerifiedAccount(
  _page: Page,
  account: { name: string; email: string; password: string }
) {
  const email = account.email.trim().toLowerCase();
  const password = await bcrypt.hash(account.password, 10);
  await prisma.user.create({
    data: {
      name: account.name,
      email,
      password,
      emailVerified: new Date(),
    },
  });
}

export async function signInWithCredentials(
  page: Page,
  account: { email: string; password: string; staffCode?: string },
  expectedPath = '/',
) {
  await page.goto('/login');
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  if (account.staffCode) await page.fill('#staffCode', account.staffCode);
  await page.click('button:has-text("Sign In with Email")');
  await expect(page).toHaveURL(expectedPath);
}

export async function registerAndSignIn(
  page: Page,
  account: { name: string; email: string; password: string }
) {
  await createVerifiedAccount(page, account);
  await signInWithCredentials(page, account);
}
