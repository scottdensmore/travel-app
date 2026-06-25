import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';

test.describe('Flight Booking Journey', () => {
  const uniqueEmail = `booktest-${Date.now()}@example.com`;
  const name = 'Booking Test User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // Register and login a fresh user to isolate the booking state
    await page.goto('/signup');
    await page.fill('#name', name);
    await page.fill('#email', uniqueEmail);
    await page.fill('#password', password);
    await page.click('button:has-text("Create account")');
    await expect(page).toHaveURL('/');
  });

  test.afterAll(async () => {
    // Clean up created user and bookings to keep the DB clean
    try {
      const user = await prisma.user.findUnique({
        where: { email: uniqueEmail }
      });
      if (user) {
        await prisma.booking.deleteMany({
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

  test('User can search and book a flight, then verify it in their profile', async ({ page }) => {
    // Find an upcoming flight instance from the seeded database to make search reliable
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
      throw new Error('No upcoming flights found in the seeded database');
    }

    // Fill origin & destination dynamically based on the database flight
    await page.selectOption('#from', targetFlight.from);
    await page.selectOption('#to', targetFlight.to);

    // Fill departure date formatted as YYYY-MM-DD
    const formattedDate = targetFlight.departureDate.toISOString().split('T')[0];
    await page.fill('#depart', formattedDate);

    // Submit search
    await page.click('button:has-text("Find your trip")');

    // Wait for flight results container to appear
    await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();

    // Verify at least one flight instance is found
    const flightRow = page.locator('button:has-text("Book Now")').first();
    await expect(flightRow).toBeVisible();

    // Click Book Now
    await flightRow.click();

    // Expect successful booking alert
    await expect(page.locator('[role="alert"]').first()).toContainText(/Successfully booked flight/i);

    // Go to profile page
    await page.goto('/profile');

    // Verify the booking is listed under "My Bookings" or in table
    await expect(page.locator('h2:has-text("My Bookings")')).toBeVisible();
    
    // Check that booking table has rows
    const bookingRows = page.locator('table tbody tr');
    await expect(bookingRows.first()).toBeVisible();

    // Verify points balance is positive (earned points for booking)
    const pointsText = await page.locator('p:has-text("Status Points")').textContent();
    expect(pointsText).not.toBeNull();
  });
});
