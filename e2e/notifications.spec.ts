import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { flightRouteInclude } from '@/lib/flightRoute';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';
import { completeCheckoutPayment } from './helpers/checkoutPayment';
import { fillOneWayFlightSearch } from './helpers/flightSearch';

test.describe('User Notifications & Alerts Journey', () => {
  const uniqueEmail = `notiftest-${Date.now()}@example.com`;
  const name = 'Notification Test User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // One account for the whole file, signed in per test. Registering in
    // `beforeEach` worked only while this spec had a single test: the second
    // one hit the unique constraint on the email.
    const existing = await prisma.user.findUnique({ where: { email: uniqueEmail } });
    if (!existing) {
      await createVerifiedAccount(page, { name, email: uniqueEmail, password });
    }
    await signInWithCredentials(page, { email: uniqueEmail, password });
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
        await prisma.paymentAttempt.deleteMany({
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
      // The route is on the airports now, not on the flight (#73).
      include: flightRouteInclude,
      orderBy: {
        departureDate: 'asc'
      }
    });

    if (!targetFlight) {
      throw new Error('No upcoming flights found in the database');
    }

    await fillOneWayFlightSearch(page, targetFlight);
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
    await page.click('button:has-text("Review Booking →")');

    // Confirm booking
    await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
    await completeCheckoutPayment(page);

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
    // The Status column. The copy shown beside the flight number when the
    // column is out of reach carries a `compact-` prefix precisely so this
    // cannot resolve to it -- it is aria-hidden and decorative (#229).
    await expect(page.getByTestId(/^booking-status-/).first()).toContainText('Cancelled');

    // Verify notification badge is "1" again
    await expect(badge).toBeVisible({ timeout: 8000 });
    await expect(badge).toHaveText('1');

    // Open drawer and verify cancellation points alert
    await bellBtn.click();
    await expect(page.locator('text=Booking Cancelled:')).toBeVisible();
    await expect(page.locator('text=Deducted -')).toBeVisible();
  });

  test('the notification drawer is readable on a phone', async ({ page }) => {
      // #208: the drawer was `position: absolute` inside a nav carrying
      // `overflow-x: auto`, which forces `overflow-y: auto` and clipped a 389px
      // panel to sixteen visible pixels. The clicks landed and the badge counted
      // down, so nothing failed -- it was simply invisible, and no test noticed
      // because every journey opens it at desktop width.
      // Sized before loading, then the bell reached by scrolling the nav, which
      // is what a real phone user does. Resizing afterwards pushes the bell off
      // the right edge, collapsing the measured inset to its floor -- the one
      // input at which the left-edge clamp is a no-op, so the test would pass
      // against the very bug it is here for.
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto('/');

      await page.locator('button[aria-label="Toggle notifications"]').click();
      const drawer = page.getByRole('dialog', { name: /notifications/i });
      await expect(drawer).toBeVisible();

      const box = (await drawer.boundingBox())!;
      const viewport = page.viewportSize()!;
      // Inside the viewport on every edge, which is the whole claim.
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      // And tall enough to read, rather than a sliver.
      expect(box.height).toBeGreaterThan(100);

      // The box alone proves nothing. `boundingBox()` reports layout geometry,
      // which an ancestor's `overflow` clipping does not affect, and
      // `toBeVisible()` ignores that clipping too -- so every assertion above
      // is satisfied by a panel that is 52% clipped and unclickable at its
      // centre, which is exactly the state #208 described. Ask the page what is
      // actually painted there.
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const paintedAtCentre = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="dialog"]') !== null,
          centre,
      );
      expect(paintedAtCentre).toBe(true);

      // The width clamp only binds below about 336px, so 390 never exercises
      // it. A phone this narrow is rare but real.
      // And it survives a resize while open, which re-measures.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => {
          const wider = (await drawer.boundingBox())!;
          return { left: wider.x >= 0, right: wider.x + wider.width <= 390 };
      }).toEqual({ left: true, right: true });
  });
});
