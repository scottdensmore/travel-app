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
  // Whichever test signs in first pays for the dev server compiling the
  // NextAuth credentials callback, which routinely costs more than the 5s
  // default. The tell was that the failure followed run order rather than any
  // one test: running a passing spec first made it fail, and it passed again
  // inside the suite. This is a mitigation, not a proven cure -- if a sign-in
  // times out again, measure before theorising.
  //
  // Distinct from #121, which is the admin MFA journey spending its own 30s
  // budget waiting on a TOTP window. Same suite, different mechanism; nothing
  // here closes it.
  await expect(page).toHaveURL(expectedPath, { timeout: 30_000 });
}

export async function registerAndSignIn(
  page: Page,
  account: { name: string; email: string; password: string }
) {
  await createVerifiedAccount(page, account);
  await signInWithCredentials(page, account);
}
