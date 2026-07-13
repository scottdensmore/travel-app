import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import FlightBookingService from '../lib/FlightBookingService';
import { updateFlightSeatingLayout } from '../lib/FlightSeatLayoutService';

test.describe('Admin Control Journey', () => {
  const adminEmail = `admin-${Date.now()}@example.com`;
  const userEmail = `user-${Date.now()}@example.com`;
  const password = 'Password123!';

  test.afterAll(async () => {
    // Clean up test users
    try {
      await prisma.booking.deleteMany({
        where: { flight: { flightNumber: 'E2E606' } }
      });
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
    const flightRow = activeTable.locator('tr:has-text("Playwright Air")').first();
    await expect(flightRow).toBeVisible();

    // Verify stats & occupancy columns
    await expect(flightRow.locator('text=0 Active')).toBeVisible();
    await expect(flightRow.locator('text=0 / 180')).toBeVisible();
    await expect(flightRow.locator('text=0.0% full')).toBeVisible();

    // Click Manifest button
    await flightRow.locator('button:has-text("Manifest")').click();

    // Verify manifest modal opens
    await expect(page.locator('h2:has-text("Passenger Manifest")')).toBeVisible();
    await expect(page.locator('text=No passengers booked on this occurrence.')).toBeVisible();

    // Close manifest modal
    await page.locator('button:has-text("Close")').click();
    await expect(page.locator('h2:has-text("Passenger Manifest")')).not.toBeVisible();

    // Select the newly generated flight's live status selector and change to "Delayed"
    const statusSelect = flightRow.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('DELAYED');

    // Navigate to user-facing flight board
    await page.goto('/flights');

    // Verify the delayed flight is listed on the user flight board
    await expect(page.locator('table').locator('text=Playwright Air').first()).toBeVisible();
    await expect(page.locator('table').locator('text=Delayed').first()).toBeVisible();

    // Override one occurrence with a custom layout through the manual generator.
    const occurrenceDate = new Date();
    occurrenceDate.setUTCDate(occurrenceDate.getUTCDate() + 35);
    const occurrenceDateString = occurrenceDate.toISOString().split('T')[0];

    await page.goto('/admin/flights');
    await page.selectOption(
      '#selectSchedule',
      { label: 'Playwright Air E2E606 (Seattle, USA → Detroit, USA)' }
    );
    await page.fill('#startDate', occurrenceDateString);
    await page.fill('#endDate', occurrenceDateString);
    await page.fill('#manualFirstClassRows', '1');
    await page.fill('#manualBusinessRows', '1');
    await page.fill('#manualPremiumEconomyRows', '1');
    await page.fill('#manualEconomyRows', '2');
    await page.fill('#manualSeatPattern', 'AC-DF');
    await page.click('button:has-text("Generate Occurrences")');
    await expect(page.getByRole('status').filter({
      hasText: 'Successfully affected 1 flight occurrence(s): 1 created, 0 updated.'
    })).toBeVisible();

    await expect.poll(async () => prisma.flight.findFirst({
      where: {
        flightNumber: 'E2E606',
        departureDate: {
          gte: new Date(`${occurrenceDateString}T00:00:00.000Z`),
          lte: new Date(`${occurrenceDateString}T23:59:59.999Z`)
        }
      }
    })).not.toBeNull();

    const persistedOccurrence = await prisma.flight.findFirstOrThrow({
      where: {
        flightNumber: 'E2E606',
        departureDate: {
          gte: new Date(`${occurrenceDateString}T00:00:00.000Z`),
          lte: new Date(`${occurrenceDateString}T23:59:59.999Z`)
        }
      }
    });
    expect(persistedOccurrence).toMatchObject({
      firstClassRows: 1,
      businessRows: 1,
      premiumEconomyRows: 1,
      economyRows: 2,
      seatPattern: 'AC-DF'
    });

    // Checkout must render only the persisted Economy rows and seat letters.
    await page.goto(`/book/${persistedOccurrence.id}`);
    await page.fill('input[placeholder="John"]', 'Layout');
    await page.fill('input[placeholder="Doe"]', 'Traveler');
    await page.fill('input[type="date"]', '1990-01-01');
    await page.fill('input[placeholder="A00000000"]', 'E2E123456');
    await page.click('button:has-text("Select Seats")');
    await expect(page.getByTitle('Select Seat 4A')).toBeVisible();
    await expect(page.getByTitle('Select Seat 5F')).toBeVisible();
    await expect(page.getByTitle('Select Seat 4B')).toHaveCount(0);

    // A layout update and booking must serialize on the same flight row.
    const raceDate = new Date(`${occurrenceDateString}T10:00:00.000Z`);
    raceDate.setUTCDate(raceDate.getUTCDate() + 1);
    const raceFlight = await prisma.flight.create({
      data: {
        flightNumber: 'E2E606',
        airline: 'Playwright Air',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: raceDate,
        price: '$499',
        firstClassRows: 3,
        businessRows: 3,
        premiumEconomyRows: 4,
        economyRows: 20,
        seatPattern: 'ABC-DEF'
      }
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const raceResults = await Promise.allSettled([
      updateFlightSeatingLayout(raceFlight.id, {
        firstClassRows: 4,
        businessRows: 3,
        premiumEconomyRows: 4,
        economyRows: 19,
        seatPattern: 'ABC-DEF'
      }),
      new FlightBookingService().bookFlight({
        flightId: raceFlight.id,
        userId: admin.id,
        passengers: [{
          firstName: 'Race',
          lastName: 'Traveler',
          dateOfBirth: '1990-01-01',
          passportNumber: 'E2ERACE123',
          gender: 'Other',
          seatNumber: '11A',
          cabinClass: 'ECONOMY'
        }],
        idempotencyKey: '92160e58-74ee-460d-a98f-f58d1ea71477'
      })
    ]);

    expect(raceResults.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const raceState = await prisma.flight.findUniqueOrThrow({
      where: { id: raceFlight.id },
      include: { passengers: true }
    });
    if (raceResults[0].status === 'fulfilled') {
      expect(raceState.firstClassRows).toBe(4);
      expect(raceState.passengers).toHaveLength(0);
    } else {
      expect(raceState.firstClassRows).toBe(3);
      expect(raceState.passengers).toHaveLength(1);
      expect(raceState.passengers[0]).toMatchObject({ seatNumber: '11A', cabinClass: 'ECONOMY' });
    }
  });
});
