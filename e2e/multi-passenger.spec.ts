import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { calculateItineraryTotal } from '../lib/bookingPricing';
import { registerAndSignIn } from './helpers/auth';

test.describe('Multi-Passenger Booking Journey', () => {
  const uniqueEmail = `multibook-${Date.now()}@example.com`;
  const name = 'Multi Booking User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // Register and login a fresh user
    await registerAndSignIn(page, { name, email: uniqueEmail, password });
  });

  test.afterAll(async () => {
    // Clean up created user, bookings, and passengers to keep DB clean
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

  test('User can book for multiple travelers, select adjacent seats coordinatedly, and view all boarding passes', async ({ page }) => {
    // Find an upcoming flight instance from the database
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

    // This journey books a single flight, so search one way: a round trip
    // is chosen a leg at a time and booked as one itinerary (#69).
    await page.getByLabel('One Way').click();

    // Fill origin & destination
    await page.selectOption('#from', targetFlight.from);
    await page.selectOption('#to', targetFlight.to);
    const formattedDate = targetFlight.departureDate.toISOString().split('T')[0];
    await page.fill('#depart', formattedDate);
    await page.click('button:has-text("Find your trip")');

    // Wait for flights and book
    await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();
    await page.locator('a:has-text("Book Now")').first().click();

    // --- STEP 1: Multiple Travelers ---
    await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
    
    // Fill Passenger #1 details
    await page.fill('input[placeholder="John"]', 'Alice');
    await page.fill('input[placeholder="Doe"]', 'Smith');
    await page.fill('input[type="date"]', '1995-05-15');
    await page.fill('input[placeholder="A00000000"]', 'US1234567');

    // Add Passenger #2
    await page.click('button:has-text("+ Add Traveler")');
    await expect(page.locator('h3:has-text("Passenger #2")')).toBeVisible();

    const inputs = page.locator('input[placeholder="John"]');
    const linputs = page.locator('input[placeholder="Doe"]');
    const passports = page.locator('input[placeholder="A00000000"]');
    const dates = page.locator('input[type="date"]');

    await inputs.nth(1).fill('Bob');
    await linputs.nth(1).fill('Jones');
    await dates.nth(1).fill('1990-10-10');
    await passports.nth(1).fill('US7654321');

    await page.click('button:has-text("Select Seats →")');

    // --- STEP 2: Coordinated Seat Selection ---
    await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();

    // Verify auto-allocate elements are present
    const checkbox = page.locator('#autoAllocateGroup');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked();

    const autoAssignBtn = page.locator('button:has-text("Auto-Assign Adjacent Seats")');
    await expect(autoAssignBtn).toBeVisible();

    // Let's click seat 11A on the map.
    // With auto-allocate active, Passenger 1 should get 11A and Passenger 2 should get adjacent 11B automatically
    const seat11A = page.locator('button[title="Select Seat 11A"]');
    await expect(seat11A).toBeVisible();
    await seat11A.click();

    // Verify both seats are assigned in the left-hand passenger cards
    const passengerCards = page.locator('div:has-text("Class: ")');
    await expect(page.locator('text=Seat: 11A')).toBeVisible();
    await expect(page.locator('text=Seat: 11B')).toBeVisible();

    // Let's go to step 3
    await page.click('button:has-text("Review Booking →")');

    // --- STEP 3: Review ---
    await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
    await expect(page.locator('text=Alice Smith')).toBeVisible();
    await expect(page.locator('text=Class: ECONOMY | Seat: 11A')).toBeVisible();
    await expect(page.locator('text=Bob Jones')).toBeVisible();
    await expect(page.locator('text=Class: ECONOMY | Seat: 11B')).toBeVisible();

    // Confirm
    await page.click('button:has-text("Confirm $")');

    // --- STEP 4: Confirmation & Boarding Passes ---
    await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 12000 });
    
    // Check both boarding passes render successfully
    await expect(page.locator('text=Alice Smith').first()).toBeVisible();
    await expect(page.locator('text=11A').first()).toBeVisible();
    await expect(page.locator('text=Bob Jones').first()).toBeVisible();
    await expect(page.locator('text=11B').first()).toBeVisible();
    const persistedBooking = await prisma.booking.findFirstOrThrow({
      where: { user: { email: uniqueEmail } },
      orderBy: { createdAt: 'desc' }
    });
    expect(persistedBooking.totalPriceCents).toBe(calculateItineraryTotal([targetFlight.priceCents], [
      { cabinClass: 'ECONOMY' },
      { cabinClass: 'ECONOMY' }
    ]).cents);
    expect(persistedBooking.paymentIntentId).toBeNull();
  });
});
