import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';

test.describe('Admin Control Journey', () => {
  const adminEmail = `admin-${Date.now()}@example.com`;
  const userEmail = `user-${Date.now()}@example.com`;
  const password = 'Password123!';

  test.afterAll(async () => {
    // Clean up test users
    try {
      await prisma.user.deleteMany({
        where: {
          email: { in: [adminEmail, userEmail] }
        }
      });
      // Clean up test schedules and flights generated
      await prisma.flight.deleteMany({
        where: { flightNumber: 'E2E606' }
      });
      await prisma.flightSchedule.deleteMany({
        where: { flightNumber: 'E2E606' }
      });
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
  });

  test('Non-admin user is blocked from admin dashboard', async ({ page }) => {
    // Register standard user
    await page.goto('/signup');
    await page.fill('#name', 'Standard User');
    await page.fill('#email', userEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page).toHaveURL('/');

    // Attempt to access admin page
    await page.goto('/admin');

    // Should be redirected away or blocked by middleware
    // Next-auth default redirects unauthorized to signin page
    await expect(page.url()).toContain('/login');
  });

  test('Admin user can access dashboard, create schedule, and change live status', async ({ page }) => {
    // Register admin user
    await page.goto('/signup');
    await page.fill('#name', 'Admin User');
    await page.fill('#email', adminEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page).toHaveURL('/');

    // Promote the user to ADMIN directly in the database
    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'ADMIN' }
    });

    // Logout and login again to refresh the JWT session token role
    await page.click('button:has-text("Sign Out")');
    await expect(page.locator('a:has-text("Sign In")')).toBeVisible();
    await page.goto('/login');
    await page.fill('#email', adminEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Sign In with Email")');
    await expect(page).toHaveURL('/');

    // Access admin dashboard
    await page.goto('/admin');
    await expect(page.locator('h1:has-text("Admin Control Center")')).toBeVisible();

    // Go to Flight Manager
    await page.click('a:has-text("Flight & Schedule Manager")');
    await expect(page).toHaveURL('/admin/flights');

    // Create a new repeating flight schedule
    await page.fill('#flightNumber', 'E2E606');
    await page.fill('#airline', 'Playwright Air');
    await page.fill('#from', 'Seattle, USA');
    await page.fill('#to', 'Detroit, USA');
    await page.fill('#departureTime', '10:00');
    await page.fill('#price', '499');

    // Select all days of the week to ensure occurrences generate in the next 7 days
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const label of dayLabels) {
      await page.check(`label:has-text("${label}") input[type="checkbox"]`);
    }

    await page.click('button:has-text("Create Schedule")');

    // Verify success alert
    await expect(page.locator('.admin-card').locator('text=New schedule created successfully!')).toBeVisible();

    // Verify schedule is in the repeating templates list
    await expect(page.locator('table').first().locator('text=Playwright Air')).toBeVisible();

    // Verify active occurrence generated
    const activeTable = page.locator('table').nth(1);
    await expect(activeTable.locator('text=Playwright Air').first()).toBeVisible();

    // Select the newly generated flight's live status selector and change to "Delayed"
    const statusSelect = activeTable.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('DELAYED');

    // Navigate to user-facing flight board
    await page.goto('/flights');

    // Verify the delayed flight is listed on the user flight board
    await expect(page.locator('table').locator('text=Playwright Air').first()).toBeVisible();
    await expect(page.locator('table').locator('text=Delayed').first()).toBeVisible();
  });
});
