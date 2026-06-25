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
        await prisma.user.delete({
          where: { id: user.id }
        });
      }
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
  });

  test('User can search, select cabin/seat, complete payment wizard, and view ticket on profile', async ({ page }) => {
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

    // Verify at least one flight instance is found and click 'Book Now' link
    const bookNowLink = page.locator('a:has-text("Book Now")').first();
    await expect(bookNowLink).toBeVisible();
    await bookNowLink.click();

    // Expect to be redirected to the booking checkout page
    await expect(page).toHaveURL(new RegExp(`/book/${targetFlight.id}`));

    // --- STEP 1: Traveler Information ---
    await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
    
    // Fill in Passenger #1 details
    await page.fill('input[placeholder="John"]', 'Bob');
    await page.fill('input[placeholder="Doe"]', 'Jones');
    await page.fill('input[type="date"]', '1990-05-15');
    await page.fill('input[placeholder="A00000000"]', 'US1234567');
    
    // Click Select Seats
    await page.click('button:has-text("Select Seats →")');

    // --- STEP 2: Seat Selection ---
    await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
    
    // Select seat 11A (an economy seat)
    const seatButton = page.locator('button[title="Select Seat 11A"]');
    await expect(seatButton).toBeVisible();
    await seatButton.click();
    
    // Click Billing & Summary
    await page.click('button:has-text("Billing & Summary →")');

    // --- STEP 3: Payment ---
    await expect(page.locator('h2:has-text("Review & Purchase")')).toBeVisible();
    
    // Verify booking summary details
    await expect(page.locator('text=Bob Jones').first()).toBeVisible();
    await expect(page.locator('text=Class: ECONOMY | Seat: 11A').first()).toBeVisible();

    // Fill simulated payment card information
    await page.fill('input[placeholder="4111 2222 3333 4444"]', '4111222233334444');
    await page.fill('input[placeholder="JOHN DOE"]', 'BOB JONES');
    await page.fill('input[placeholder="MM/YY"]', '12/29');
    await page.fill('input[placeholder="123"]', '123');

    // Submit Booking
    await page.click('button:has-text("Pay ")');

    // --- STEP 4: Success & Boarding Pass ---
    await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Bob Jones').first()).toBeVisible();
    await expect(page.locator('text=11A').first()).toBeVisible();
    
    // Navigate to profile bookings
    await page.click('a:has-text("View Profile Bookings")');

    // Verify booking list
    await expect(page).toHaveURL('/profile');
    await expect(page.locator('h2:has-text("My Bookings")')).toBeVisible();
    
    const bookingRows = page.locator('table tbody tr');
    await expect(bookingRows.first()).toBeVisible();
    
    // Verify points balance has increased (non-zero status points)
    const pointsText = await page.locator('p:has-text("Status Points")').textContent();
    expect(pointsText).not.toBeNull();
    const pointsNum = parseInt(pointsText?.replace(/[^0-9]/g, '') || '0', 10);
    expect(pointsNum).toBeGreaterThan(0);

    // --- CHANGE SEATS FLOW ---
    await page.click('button:has-text("Change Seats")');
    await expect(page.locator('h2:has-text("Change Seats")')).toBeVisible();

    // Select seat 11B in the modal
    const newSeatButton = page.locator('button[title="Select Seat 11B"]');
    await expect(newSeatButton).toBeVisible();
    await newSeatButton.click();

    // Save
    await page.click('button:has-text("Save New Seats")');
    await expect(page.locator('h2:has-text("Change Seats")')).not.toBeVisible();
    await expect(page.locator('text=Bob (11B)')).toBeVisible();

    // --- CANCEL BOOKING FLOW ---
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to cancel booking for flight');
      await dialog.accept();
    });
    await page.click('button:has-text("Cancel")');

    // Confirm cancel status badge and action buttons are gone
    await expect(page.locator('text=Cancelled').first()).toBeVisible();
    await expect(page.locator('button:has-text("Change Seats")')).not.toBeVisible();
    
    // Confirm points are deducted back to starting points (1300)
    const pointsTextAfterCancel = await page.locator('p:has-text("Status Points")').textContent();
    const pointsNumAfter = parseInt(pointsTextAfterCancel?.replace(/[^0-9]/g, '') || '0', 10);
    expect(pointsNumAfter).toBe(1300);

    // Confirm negative entry is visible in points activity log
    await expect(page.locator('text=❌ Cancelled:').first()).toBeVisible();
  });
});
