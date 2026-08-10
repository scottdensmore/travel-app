import { expect, test } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { createAuthRateLimitKey } from '../lib/authRateLimit';
import { prisma } from '../lib/prisma';

loadEnvConfig(process.cwd());

test.describe('Authentication abuse protection', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `Case-${suffix}@Example.com`;
  const normalizedEmail = email.toLowerCase();
  const unknownEmail = `unknown-${suffix}@example.com`;
  const password = 'Password123!';
  const rateLimitSecret = process.env.NEXTAUTH_SECRET;
  if (!rateLimitSecret) {
    throw new Error('NEXTAUTH_SECRET is required for authentication E2E cleanup.');
  }
  const registrationRateLimitKey = createAuthRateLimitKey(
    'register-email',
    normalizedEmail,
    rateLimitSecret
  );
  const normalizedLoginRateLimitKey = createAuthRateLimitKey(
    'login-email',
    normalizedEmail,
    rateLimitSecret
  );
  const rateLimitKeys = [
    registrationRateLimitKey,
    normalizedLoginRateLimitKey,
    createAuthRateLimitKey('login-email', unknownEmail, rateLimitSecret)
  ];

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: normalizedEmail } });
    // Registration issues one, and it outlives the account it belongs to: no
    // foreign key ties them, so deleting the user leaves the token behind and
    // 20 had accumulated (#213).
    await prisma.verificationToken.deleteMany({
      where: { identifier: { endsWith: `:${normalizedEmail}` } }
    });
    await prisma.authRateLimit.deleteMany({
      where: { key: { in: rateLimitKeys } }
    });
  });

  test('normalizes case variants, keeps immediate responses generic, and rate limits abuse', async ({ page, request }) => {
    const registrationBodies = [email, normalizedEmail, email.toUpperCase()];
    for (const candidate of registrationBodies) {
      const response = await request.post('/api/auth/register', {
        data: { name: 'Case Traveler', email: candidate, password }
      });
      expect(response.status()).toBe(202);
      expect(await response.json()).toEqual({
        message: 'If this address can be registered, the request has been accepted.'
      });
    }

    const blockedRegistration = await request.post('/api/auth/register', {
      data: { name: 'Case Traveler', email, password }
    });
    expect(blockedRegistration.status()).toBe(429);
    expect(await prisma.user.count({ where: { email: normalizedEmail } })).toBe(1);

    const attemptLogin = async (candidateEmail: string) => {
      await page.goto('/login');
      await page.fill('#email', candidateEmail);
      await page.fill('#password', 'DefinitelyWrong123!');
      await page.click('button:has-text("Sign In with Email")');
      await expect(page.locator('form').getByRole('alert')).toHaveText('Invalid email or password.');
    };

    await attemptLogin(normalizedEmail);
    await attemptLogin(unknownEmail);
    for (let attempt = 1; attempt < 6; attempt++) {
      await attemptLogin(email.toUpperCase());
    }

    expect(await prisma.authRateLimit.findUnique({
      where: { key: normalizedLoginRateLimitKey },
      select: { attempts: true }
    })).toEqual({ attempts: 6 });

    await expect(prisma.user.create({
      data: { name: 'Mixed Case', email: `Mixed-${suffix}@Example.com`, password: 'not-used' }
    })).rejects.toThrow();
  });
});
