import { expect, test } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/prisma';
import { createAuthRateLimitKey } from '../lib/authRateLimit';
import { authEmailLink, deleteAuthEmails } from './helpers/mailpit';

loadEnvConfig(process.cwd());

test.describe('Verified email and password recovery', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `recovery-${suffix}@example.com`;
  const password = 'Password123!';
  const newPassword = 'NewPassword123!';
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for recovery E2E cleanup.');
  const rateLimitKeys = [
    createAuthRateLimitKey('register-email', email, secret),
    createAuthRateLimitKey('verify-request-email', email, secret),
    createAuthRateLimitKey('reset-request-email', email, secret),
    createAuthRateLimitKey('login-email', email, secret),
  ];

  test.afterAll(async ({ request }) => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.verificationToken.deleteMany({
      where: { identifier: { endsWith: `:${email}` } }
    });
    await prisma.authRateLimit.deleteMany({ where: { key: { in: rateLimitKeys } } });
    await deleteAuthEmails(request, email);
  });

  test('activates a new account and resets its password through delivered links', async ({ page, request, context }) => {
    await page.goto('/signup');
    await page.fill('#name', 'Recovery Traveler');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page.locator('form').getByRole('status')).toHaveText(
      'If this address is eligible, check your email for a verification link.'
    );
    await expect(prisma.user.findUnique({ where: { email }, select: { emailVerified: true } }))
      .resolves.toEqual({ emailVerified: null });

    const verificationLink = await authEmailLink(
      request,
      email,
      'Verify your Mona Airways email',
      '/verify-email'
    );
    await page.goto(verificationLink);
    await expect(page.getByRole('button', { name: 'Verify email' })).toBeVisible();
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('status')).toHaveText('Your email has been verified.');

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button:has-text("Sign In with Email")');
    await expect(page).toHaveURL('/');

    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Send password reset email' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'If the account is eligible, an email will be sent shortly.'
    );
    const resetLink = await authEmailLink(
      request,
      email,
      'Reset your Mona Airways password',
      '/reset-password'
    );
    await page.goto(resetLink);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status')).toHaveText('Your password has been reset.');

    const invalidatedSession = await page.request.get('/api/auth/session');
    expect(await invalidatedSession.json()).toBeNull();

    await context.clearCookies();
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button:has-text("Sign In with Email")');
    await expect(page.locator('form').getByRole('alert')).toHaveText('Invalid email or password.');
    await page.fill('#password', newPassword);
    await page.click('button:has-text("Sign In with Email")');
    await expect(page).toHaveURL('/');
  });
});
