import { expect, type Page } from '@playwright/test';

/**
 * Cross the hosted-payment boundary used by Playwright's disposable app
 * server. Production can never enable this adapter; the provider enforces the
 * environment guard before it returns the marker that renders these fields.
 */
export async function openCheckoutPayment(page: Page) {
  await page.getByRole('button', { name: 'Continue to secure payment' }).click();
  const paymentHeading = page.getByRole('heading', { name: 'Secure payment' });
  await expect(paymentHeading).toBeFocused();
  await expect(paymentHeading).toHaveCSS('outline', 'rgb(251, 191, 36) solid 3px');
  await expect(paymentHeading).toHaveCSS('outline-offset', '3px');
  await expect(page.getByRole('group', { name: 'Playwright hosted payment fields' })).toBeVisible();
  return page.getByRole('button', { name: /Authorize .* and confirm booking/ });
}

export async function completeCheckoutPayment(page: Page) {
  const authorizeButton = await openCheckoutPayment(page);
  await authorizeButton.click();
}
