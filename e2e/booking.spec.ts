import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { calculateItineraryTotal } from '../lib/bookingPricing';
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
      // The route is on the airports now, not on the flight (#73).
      include: flightRouteInclude,
      orderBy: {
        departureDate: 'asc'
      }
    });

    if (!targetFlight) {
      throw new Error('No upcoming flights found in the seeded database');
    }

    // This journey books a single flight, so search one way: a round trip is
    // chosen a leg at a time and booked as one itinerary instead (#69).
    await page.getByLabel('One Way').click();

    // Fill origin & destination dynamically based on the database flight
    await page.selectOption('#from', targetFlight.fromAirport.label);
    await page.selectOption('#to', targetFlight.toAirport.label);

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
    // The seat is printed inside the leg that holds it (#152).
    await expect(page.getByTestId('review-leg')).toContainText('Seat 11A');
    await expect(page.locator('text=Class: Economy').first()).toBeVisible();

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
    const expectedTotal = calculateItineraryTotal([targetFlight.priceCents], [{ cabinClass: 'ECONOMY' }]);
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

  test('User chooses both legs in search and carries them into checkout', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-search-ready="true"]')).toBeVisible();

    // The default route operates in both directions (#113), so a round-trip
    // search returns real return inventory to choose from.
    await page.getByRole('button', { name: 'Find your trip' }).click();
    const inbound = page.getByTestId('inbound-results');
    await expect(inbound).toBeVisible();
    await expect(inbound.locator('.flight-result-card').first()).toBeVisible();

    // A round trip is not bookable one card at a time.
    await expect(page.getByRole('link', { name: 'Book Now' })).toHaveCount(0);

    const cta = page.getByTestId('round-trip-book');
    await expect(cta).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('round-trip-summary')).toContainText(/choose a departing flight/i);

    await page.getByRole('button', { name: /as the departing leg/ }).first().click();
    await expect(page.getByTestId('round-trip-summary')).toContainText(/choose a return flight/i);

    await page.getByRole('button', { name: /as the return leg/ }).first().click();
    await expect(page.getByTestId('round-trip-summary')).toContainText(/total/i);

    const href = await page.getByTestId('round-trip-book').getAttribute('href');
    expect(href).toMatch(/^\/checkout\?outbound=\d+&inbound=\d+$/);

    await page.getByTestId('round-trip-book').click();

    // Checkout receives both legs, so the wizard offers a seat for each.
    await expect(page).toHaveURL(href!);
    await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
    await page.fill('input[placeholder="John"]', 'Ada');
    await page.fill('input[placeholder="Doe"]', 'Lovelace');
    await page.fill('input[type="date"]', '1980-12-10');
    await page.fill('input[placeholder="A00000000"]', 'US4443333');
    await page.click('button:has-text("Select Seats →")');
    await expect(page.getByRole('tab')).toHaveCount(2);
  });

  test('User can book a round trip and both legs are seated and persisted', async ({ page }) => {
    const outbound = withRouteLabels(await prisma.flight.findFirstOrThrow({
      where: { departureDate: { gt: new Date() } },
      include: flightRouteInclude,
      orderBy: { departureDate: 'asc' }
    }));
    // A true reverse leg when the schedule has one, otherwise any other upcoming
    // flight — this journey exercises checkout mechanics, not route pairing.
    const inbound = withRouteLabels(
      (await prisma.flight.findFirst({
        where: {
          fromAirportCode: outbound.toAirportCode,
          toAirportCode: outbound.fromAirportCode,
          departureDate: { gt: outbound.departureDate }
        },
        include: flightRouteInclude,
        orderBy: { departureDate: 'asc' }
      })) ??
      (await prisma.flight.findFirstOrThrow({
        where: { id: { not: outbound.id }, departureDate: { gt: new Date() } },
        include: flightRouteInclude,
        orderBy: { departureDate: 'asc' }
      })));

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

    // Deliberately not the first free seat: both legs are empty and identically
    // laid out, so taking .first() on each gives the same seat name and the
    // review assertions below could not tell a swapped pairing from a correct
    // one.
    const inboundSeat = page.locator('button[title^="Select Seat"]').nth(1);
    const inboundSeatName = (await inboundSeat.getAttribute('title'))!.replace('Select Seat ', '');
    await inboundSeat.click();

    // --- STEP 3: Review shows both legs, each carrying its own seat ---
    //
    // This used to assert the pooled list "Seats: 11A, 12C", which passed
    // whether or not the seats were paired with the right legs — and the review
    // step was in fact showing a single leg at the time (#152). Asserting each
    // seat inside its own leg is what tells those two states apart.
    await page.click('button:has-text("Review Booking →")');
    await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
    const reviewLegs = page.getByTestId('review-leg');
    await expect(reviewLegs).toHaveCount(2);
    await expect(reviewLegs.nth(0)).toContainText('Departing');
    await expect(reviewLegs.nth(0)).toContainText(`Seat ${outboundSeatName}`);
    await expect(reviewLegs.nth(1)).toContainText('Returning');
    await expect(reviewLegs.nth(1)).toContainText(`Seat ${inboundSeatName}`);

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
      calculateItineraryTotal([outbound.priceCents, inbound.priceCents],
        [{ cabinClass: 'ECONOMY' }]).cents;
    expect(booking.totalPriceCents).toBe(expectedTotal);

    // --- The profile shows the whole itinerary, not just the outbound ---
    await page.goto('/profile');
    await expect(page.locator('h2:has-text("My Bookings")')).toBeVisible();

    const row = page.getByTestId(`booking-row-${booking.id}`);
    await expect(row).toContainText('Round trip');
    await expect(row).toContainText(outbound.flightNumber);
    await expect(row).toContainText(inbound.flightNumber);
    await expect(row).toContainText(`${outbound.from} → ${outbound.to}`);
    await expect(row).toContainText(`${inbound.from} → ${inbound.to}`);

    // The seat held on each leg, read from that leg's own assignment.
    const legRows = row.getByTestId(/^booking-leg-/);
    await expect(legRows).toHaveCount(2);
    await expect(legRows.nth(0)).toContainText(outboundSeatName);
    await expect(legRows.nth(1)).toContainText(inboundSeatName);

    // --- Changing the return seat leaves the outbound one alone ---
    await row.getByRole('button', { name: 'Change Seats' }).click();
    await expect(page.getByRole('heading', { name: 'Change Seats' })).toBeVisible();

    const modalLegs = page.getByTestId('seat-change-legs').getByRole('tab');
    await expect(modalLegs).toHaveCount(2);
    await modalLegs.nth(1).click();

    // A free seat on the inbound that is not the one already held there.
    const replacement = page
      .locator(`button[title^="Select Seat"]:not([title="Select Seat ${inboundSeatName}"])`)
      .first();
    const replacementName = (await replacement.getAttribute('title'))!.replace('Select Seat ', '');
    await replacement.click();
    await page.getByRole('button', { name: 'Save New Seats' }).click();
    await expect(page.getByRole('heading', { name: 'Change Seats' })).not.toBeVisible();

    const changed = await prisma.itineraryLeg.findMany({
      where: { bookingId: booking.id },
      orderBy: { sequence: 'asc' },
      include: { seatAssignments: true },
    });
    expect(changed[0].seatAssignments.map(s => s.seatNumber)).toEqual([outboundSeatName]);
    expect(changed[1].seatAssignments.map(s => s.seatNumber)).toEqual([replacementName]);
  });
});
