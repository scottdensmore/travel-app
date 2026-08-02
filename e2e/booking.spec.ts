import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { calculateBookingTotal } from '../lib/bookingPricing';
import { registerAndSignIn } from './helpers/auth';

test.describe('Flight Booking Journey', () => {
  const runId = Date.now();
  const name = 'Booking Test User';
  const password = 'Password123!';
  // One account per test: a shared address collides on the second registration,
  // and a shared booking history would leak state between journeys.
  const createdEmails: string[] = [];
  let uniqueEmail = '';

  test.beforeEach(async ({ page }, testInfo) => {
    // Register and login a fresh user to isolate the booking state
    uniqueEmail = `booktest-${runId}-${testInfo.testId}@example.com`;
    createdEmails.push(uniqueEmail);
    await registerAndSignIn(page, { name, email: uniqueEmail, password });
  });

  test.afterAll(async () => {
    // Clean up created users and bookings to keep the DB clean
    for (const email of createdEmails) {
      try {
        const user = await prisma.user.findUnique({
          where: { email }
        });
        if (!user) continue;
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
      } catch (e) {
        console.error('Cleanup failed:', e);
      }
    }
  });

  test('User can search, select cabin and seat, confirm booking, and view it on profile', async ({ page }) => {
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

    // Verify filters card and sort selection dropdown are visible
    await expect(page.locator('h3:has-text("Filters")')).toBeVisible();
    const sortSelect = page.locator('select#sortBy');
    await expect(sortSelect).toBeVisible();

    // Verify interactive sorting option select
    await sortSelect.selectOption('price-desc');

    // Verify at least one flight instance is found and click 'Book Now' link
    const bookNowLink = page.locator('a:has-text("Book Now")').first();
    await expect(bookNowLink).toBeVisible();
    await bookNowLink.click();

    // Expect to be redirected to the booking checkout page
    await expect(page).toHaveURL(new RegExp(`/checkout\\?outbound=${targetFlight.id}`));
    await page.setViewportSize({ width: 320, height: 800 });

    // --- STEP 1: Traveler Information ---
    await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
    await expect(page.locator('.booking-traveler-actions')).toHaveCSS('flex-direction', 'column');
    
    // Fill in Passenger #1 details
    await page.fill('input[placeholder="John"]', 'Bob');
    await page.fill('input[placeholder="Doe"]', 'Jones');
    await page.fill('input[type="date"]', '1990-05-15');
    await page.fill('input[placeholder="A00000000"]', 'US1234567');
    
    // Click Select Seats
    await page.click('button:has-text("Select Seats →")');

    // --- STEP 2: Seat Selection ---
    await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
    await expect(page.locator('.booking-seat-actions')).toHaveCSS('flex-direction', 'column');
    
    // Select seat 11A (an economy seat)
    const seatButton = page.locator('button[title="Select Seat 11A"]');
    await expect(seatButton).toBeVisible();
    await seatButton.click();
    
    // Continue to review
    await page.click('button:has-text("Review Booking →")');

    // --- STEP 3: Review ---
    await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
    
    // Verify booking summary details
    await expect(page.locator('text=Bob Jones').first()).toBeVisible();
    await expect(page.locator('text=Class: ECONOMY | Seat: 11A').first()).toBeVisible();

    await expect(page.locator('text=Payment is not collected in this demo')).toBeVisible();
    await expect(page.locator('input[placeholder="4111 2222 3333 4444"]')).not.toBeVisible();

    const reviewActions = page.locator('.booking-review-actions');
    await expect(reviewActions).toHaveCSS('flex-direction', 'column');
    const confirmButton = page.locator('button:has-text("Confirm $")');
    const actionsBox = await reviewActions.boundingBox();
    const confirmBox = await confirmButton.boundingBox();
    expect(actionsBox).not.toBeNull();
    expect(confirmBox).not.toBeNull();
    expect(confirmBox!.width).toBeLessThanOrEqual(actionsBox!.width);

    // Confirm Booking
    await confirmButton.click();

    // --- STEP 4: Success & Boarding Pass ---
    await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.booking-success-actions')).toHaveCSS('flex-direction', 'column');
    await expect(page.locator('text=Bob Jones').first()).toBeVisible();
    await expect(page.locator('text=11A').first()).toBeVisible();
    const persistedBooking = await prisma.booking.findFirstOrThrow({
      where: { user: { email: uniqueEmail } },
      orderBy: { createdAt: 'desc' }
    });
    const expectedTotal = calculateBookingTotal(targetFlight.price, [{ cabinClass: 'ECONOMY' }]);
    expect(persistedBooking.totalPriceCents).toBe(expectedTotal.cents);
    expect(persistedBooking.paymentIntentId).toBeNull();
    expect(persistedBooking.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    
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

  test('legacy /book/:id links redirect to the itinerary checkout', async ({ page }) => {
    const flight = await prisma.flight.findFirstOrThrow({
      where: { departureDate: { gt: new Date() } },
      orderBy: { departureDate: 'asc' }
    });

    await page.goto(`/book/${flight.id}`);

    await expect(page).toHaveURL(`/checkout?outbound=${flight.id}`);
    await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
  });

  test('User can book a round trip and both legs are seated and persisted', async ({ page }) => {
    const outbound = await prisma.flight.findFirstOrThrow({
      where: { departureDate: { gt: new Date() } },
      orderBy: { departureDate: 'asc' }
    });
    // A true reverse leg when the schedule has one, otherwise any other upcoming
    // flight — this journey exercises checkout mechanics, not route pairing.
    const inbound =
      (await prisma.flight.findFirst({
        where: {
          from: outbound.to,
          to: outbound.from,
          departureDate: { gt: outbound.departureDate }
        },
        orderBy: { departureDate: 'asc' }
      })) ??
      (await prisma.flight.findFirstOrThrow({
        where: { id: { not: outbound.id }, departureDate: { gt: new Date() } },
        orderBy: { departureDate: 'asc' }
      }));

    await page.goto(`/checkout?outbound=${outbound.id}&inbound=${inbound.id}`);

    // --- STEP 1: Traveler Information ---
    await page.fill('input[placeholder="John"]', 'Rita');
    await page.fill('input[placeholder="Doe"]', 'Levi');
    await page.fill('input[type="date"]', '1985-03-20');
    await page.fill('input[placeholder="A00000000"]', 'US7778888');
    await page.click('button:has-text("Select Seats →")');

    // --- STEP 2: A seat per leg ---
    const legTabs = page.getByRole('tab');
    await expect(legTabs).toHaveCount(2);
    await expect(legTabs.nth(0)).toContainText('Departing');
    await expect(legTabs.nth(1)).toContainText('Returning');

    // The return leg still needs a seat, so review must refuse to open.
    const outboundSeat = page.locator('button[title^="Select Seat"]').first();
    const outboundSeatName = (await outboundSeat.getAttribute('title'))!.replace('Select Seat ', '');
    await outboundSeat.click();
    await page.click('button:has-text("Review Booking →")');
    await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
    // Not [role="alert"]: Next's route announcer is also one.
    await expect(page.getByText(/Please select a returning seat/i)).toBeVisible();
    await expect(legTabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    const inboundSeat = page.locator('button[title^="Select Seat"]').first();
    const inboundSeatName = (await inboundSeat.getAttribute('title'))!.replace('Select Seat ', '');
    await inboundSeat.click();

    // --- STEP 3: Review shows both seats ---
    await page.click('button:has-text("Review Booking →")');
    await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
    await expect(
      page.locator(`text=Seats: ${outboundSeatName}, ${inboundSeatName}`).first()
    ).toBeVisible();

    await page.locator('button:has-text("Confirm $")').click();
    await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 10000 });

    // --- Persistence: two legs in itinerary order, one seat on each ---
    const booking = await prisma.booking.findFirstOrThrow({
      where: { user: { email: uniqueEmail } },
      orderBy: { createdAt: 'desc' },
      include: {
        legs: { orderBy: { sequence: 'asc' }, include: { seatAssignments: true } }
      }
    });

    expect(booking.legs.map(leg => leg.flightId)).toEqual([outbound.id, inbound.id]);
    expect(booking.legs[0].seatAssignments.map(seat => seat.seatNumber)).toEqual([outboundSeatName]);
    expect(booking.legs[1].seatAssignments.map(seat => seat.seatNumber)).toEqual([inboundSeatName]);

    const expectedTotal =
      calculateBookingTotal(outbound.price, [{ cabinClass: 'ECONOMY' }]).cents +
      calculateBookingTotal(inbound.price, [{ cabinClass: 'ECONOMY' }]).cents;
    expect(booking.totalPriceCents).toBe(expectedTotal);
  });
});
