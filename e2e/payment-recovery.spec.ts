import { expect, test } from '@playwright/test';
import { prisma } from '@/lib/prisma';
import {
    createStaffTotpCode,
    encryptStaffMfaSecret,
    generateStaffMfaSecret,
} from '@/lib/staffMfa';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';
import { openCheckoutPayment } from './helpers/checkoutPayment';

test.describe('Staff payment recovery', () => {
    const email = `payment-ops-${Date.now()}@example.com`;
    const password = 'Password123!';
    const secret = generateStaffMfaSecret();

    test.afterAll(async () => {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return;
        await prisma.seatHold.deleteMany({ where: { holderKey: { contains: user.id } } });
        await prisma.paymentAttempt.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
    });

    test('verified staff can safely refresh a stale provider-backed attempt', async ({ page }) => {
        await createVerifiedAccount(page, { name: 'Payment Operator', email, password });
        const staff = await prisma.user.findUniqueOrThrow({ where: { email } });
        await prisma.user.update({
            where: { id: staff.id },
            data: {
                role: 'ADMIN',
                staffMfaSecretEncrypted: encryptStaffMfaSecret(secret, staff.id),
                staffMfaEnrolledAt: new Date(),
            },
        });
        await signInWithCredentials(page, {
            email,
            password,
            staffCode: createStaffTotpCode(secret),
        }, '/admin');

        const flight = await prisma.flight.findFirstOrThrow({
            where: { departureDate: { gt: new Date() } },
            orderBy: { departureDate: 'asc' },
        });
        await page.goto(`/checkout?outbound=${flight.id}`);
        await page.getByPlaceholder('John').fill('Payment');
        await page.getByPlaceholder('Doe').fill('Operator');
        await page.locator('input[type="date"]').fill('1990-05-15');
        await page.getByPlaceholder('A00000000').fill('OPS-RECOVERY-1');
        await page.getByRole('button', { name: 'Select Seats →' }).click();
        await page.locator('button[title^="Select Seat"]').first().click();
        await page.getByRole('button', { name: 'Review Booking →' }).click();
        await openCheckoutPayment(page);

        const attempt = await prisma.paymentAttempt.findFirstOrThrow({
            where: { userId: staff.id },
        });
        expect(attempt.providerIntentId).toMatch(/^pi_playwright_/);
        await prisma.$executeRaw`
            UPDATE "PaymentAttempt"
            SET "updatedAt" = statement_timestamp() - interval '11 minutes'
            WHERE "id" = ${attempt.id}
        `;

        await page.goto('/admin');
        await page.getByRole('link', { name: /Payment Recovery/i }).click();
        await expect(page).toHaveURL('/admin/payments');
        const card = page.getByRole('article', { name: `Payment attempt ${attempt.id}` });
        await expect(card).toContainText('Payment Operator');
        await expect(card).toContainText(attempt.providerIntentId!);
        await card.getByRole('button', { name: 'Refresh payment status' }).click();

        const feedback = page.getByRole('status');
        await expect(feedback).toHaveText('Payment status is still REQUIRES_PAYMENT_METHOD.');
        await expect(feedback).toBeFocused();
        await expect(feedback).toHaveCSS('outline', 'rgb(251, 191, 36) solid 3px');
        await expect(feedback).toHaveCSS('outline-offset', '3px');
        await expect(prisma.paymentWebhookEvent.count({
            where: { paymentAttemptId: attempt.id },
        })).resolves.toBe(0);
    });
});
