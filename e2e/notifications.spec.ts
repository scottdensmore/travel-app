import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';

test.describe('User Notifications & Alerts Journey', () => {
  const uniqueEmail = `notiftest-${Date.now()}@example.com`;
  const name = 'Notification Test User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // Register and login a fresh user to isolate notifications state
    await page.goto('/signup');
    await page.fill('#name', name);
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page).toHaveURL('/');
  });

  test.afterAll(async () => {
    // Clean up created user, bookings, and notifications to keep DB clean
    try {
      const user = await prisma.user.findUnique({
        where: { email: uniqueEmail }
      });
      if (user) {
        const bookings = await prisma.booking.findMany({
          where: { userId: user.id }
        });
        for (const booking of bookings) {
          await prisma.passenger.deleteMany({
            where: { bookingId: booking.id }
          });
        }
        await prisma.booking.deleteMany({
          where: { userId: user.id }
        });
        await prisma.notification.deleteMany({
          where: { userId: user.id }
        });
        await prisma.user.delete({
          where: { id: user.id }
        });
      }
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
  });

  test('User receives points credit/debit alerts in the header notification drawer', async ({ page }) => {
    // 1. Initial State: bell is present, clicking it shows empty state
    const bellBtn = page.locator('button[aria-label="Toggle notifications"]');
    await expect(bellBtn).toBeVisible();
    
    // No unread badge initially
    await expect(bellBtn.locator('span')).not.toBeVisible();

    await bellBtn.click();
    await expect(page.locator('text=You\'re all caught up!')).toBeVisible();
    await bellBtn.click(); // Close drawer

    // 2. Perform a Flight Booking to trigger a POINTS notification
    const targetFlight = await prisma.flight.findFirst({
      where: {
        departureDate: {
          gt: new Date()
        }
      },
      orderBy: {
        departureDate: 'asc'
      }
    });

    if (!targetFlight) {
      throw new Error('No upcoming flights found in the database');
    }

    await page.selectOption('#from', targetFlight.from);
    await page.selectOption('#to', targetFlight.to);
    const formattedDate = targetFlight.departureDate.toISOString().split('T')[0];
    await page.fill('#depart', formattedDate);
    await page.click('button:has-text("Find your trip")');

    await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();
    await page.locator('a:has-text("Book Now")').first().click();

    // Fill passenger details
    await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
    await page.fill('input[placeholder="John"]', 'Bob');
    await page.fill('input[placeholder="Doe"]', 'Jones');
    await page.fill('input[type="date"]', '1990-05-15');
    await page.fill('input[placeholder="A00000000"]', 'US1234567');
    await page.click('button:has-text("Select Seats →")');

    // Seat selection
    await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
    const seatBtn = page.locator('button[title="Select Seat 11A"]');
    await expect(seatBtn).toBeVisible();
    await seatBtn.click();
    await page.click('button:has-text("Billing & Summary →")');

    // Purchase
    await expect(page.locator('h2:has-text("Review & Purchase")')).toBeVisible();
    await page.fill('input[placeholder="4111 2222 3333 4444"]', '4111222233334444');
    await page.fill('input[placeholder="JOHN DOE"]', 'BOB JONES');
    await page.fill('input[placeholder="MM/YY"]', '12/29');
    await page.fill('input[placeholder="123"]', '123');
    await page.click('button:has-text("Pay ")');

    // Expect confirmation
    await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 12000 });

    // 3. Verify notification badge is "1"
    const badge = bellBtn.locator('span');
    await expect(badge).toBeVisible({ timeout: 8000 });
    await expect(badge).toHaveText('1');

    // 4. Open drawer and read notification
    await bellBtn.click();
    await expect(page.locator('text=Booking Confirmed:')).toBeVisible();
    
    // Click unread notification to mark as read
    await page.locator('.notification-item').first().click();
    
    // Badge should disappear (0 unread notifications)
    await expect(badge).not.toBeVisible();
    await bellBtn.click(); // close drawer

    // 5. Cancel Booking to trigger POINTS deduction notification
    await page.click('a:has-text("View Profile Bookings")');
    await expect(page).toHaveURL('/profile');

    page.once('dialog', async dialog => {
      await dialog.accept();
    });
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('text=Cancelled').first()).toBeVisible();

    // Verify notification badge is "1" again
    await expect(badge).toBeVisible({ timeout: 8000 });
    await expect(badge).toHaveText('1');

    // Open drawer and verify cancellation points alert
    await bellBtn.click();
    await expect(page.locator('text=Booking Cancelled:')).toBeVisible();
    await expect(page.locator('text=Deducted -')).toBeVisible();
  });
});
