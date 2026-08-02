import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import FlightBookingService from '../lib/FlightBookingService';
import { updateFlightSeatingLayout } from '../lib/FlightSeatLayoutService';
import { createVerifiedAccount, registerAndSignIn, signInWithCredentials } from './helpers/auth';
import { createStaffTotpCode } from '../lib/staffMfa';

async function waitForStableTotpWindow() {
  const remainder = Date.now() % 30_000;
  if (remainder > 24_000) {
    await new Promise(resolve => setTimeout(resolve, 31_000 - remainder));
  }
}

test.describe('Admin Control Journey', () => {
  const adminEmail = `admin-${Date.now()}@example.com`;
  const userEmail = `user-${Date.now()}@example.com`;
  const password = 'Password123!';

  test.afterAll(async () => {
    // Clean up test users
    try {
      await prisma.booking.deleteMany({
        where: { legs: { some: { flight: { flightNumber: 'E2E606' } } } }
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
    await registerAndSignIn(page, { name: 'Standard User', email: userEmail, password });

    // Attempt to access admin page
    await page.goto('/admin');

    // Should be redirected away or blocked by middleware
    // Next-auth default redirects unauthorized to signin page
    await expect(page.url()).toContain('/login');
  });

  test('Admin user can access dashboard, create schedule, and change live status', async ({ page }) => {
    // Register admin user
    await createVerifiedAccount(page, { name: 'Admin User', email: adminEmail, password });

    // Promote the user to ADMIN directly in the database
    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'ADMIN' }
    });

    await signInWithCredentials(page, { email: adminEmail, password }, '/staff/mfa');

    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    const secret = (await page.getByTestId('staff-mfa-manual-key').textContent())!.trim();
    await waitForStableTotpWindow();
    const enrollmentTime = new Date();
    await page.getByLabel('Six-digit security code')
      .fill(createStaffTotpCode(secret, new Date(enrollmentTime.getTime() - 30_000)));
    await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    await expect(page).toHaveURL(/\/login\?staffMfa=enrolled/);

    await signInWithCredentials(page, {
      email: adminEmail,
      password,
      staffCode: createStaffTotpCode(secret),
    }, '/admin');

    // Access admin dashboard
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

    // Persist a real protected passenger so the browser journey proves the
    // database-to-RSC-to-DOM projection never exposes restricted fields.
    const activeOccurrence = await prisma.flight.findFirstOrThrow({
      where: {
        flightNumber: 'E2E606',
        departureDate: { gt: new Date() }
      },
      orderBy: { departureDate: 'asc' }
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await new FlightBookingService().bookFlight({
      flightIds: [activeOccurrence.id],
      userId: admin.id,
      passengers: [{
        firstName: 'Manifest',
        lastName: 'Traveler',
        dateOfBirth: '1988-04-12',
        passportNumber: 'E2EMANIFEST123',
        gender: 'Other',
        seatNumbers: ['11A'],
        cabinClass: 'ECONOMY'
      }],
      idempotencyKey: 'de45ec8a-4ae2-4ac7-aa64-e8d9588963c2'
    });
    const protectedPassenger = await prisma.passenger.findFirstOrThrow({
      where: {
        booking: { userId: admin.id, legs: { some: { flightId: activeOccurrence.id } } }
      }
    });
    const restrictedValues = [
      '1988-04-12',
      'E2EMANIFEST123',
      protectedPassenger.dateOfBirthEncrypted!,
      protectedPassenger.passportNumberEncrypted!
    ];

    const profileResponse = await page.goto('/profile');
    expect(profileResponse?.ok()).toBe(true);
    const profileResponseBody = await profileResponse!.text();
    const profileVisibleText = await page.locator('body').innerText();
    await expect(page.getByText('Manifest (11A)')).toBeVisible();
    for (const value of restrictedValues) {
      expect(profileResponseBody).not.toContain(value);
      expect(profileVisibleText).not.toContain(value);
    }
    expect(profileVisibleText).not.toContain('Passport');
    expect(profileVisibleText).not.toContain('DOB');

    const adminFlightsResponse = await page.goto('/admin/flights');
    expect(adminFlightsResponse?.ok()).toBe(true);
    const adminFlightsResponseBody = await adminFlightsResponse!.text();
    const adminVisibleText = await page.locator('body').innerText();
    for (const value of restrictedValues) {
      expect(adminFlightsResponseBody).not.toContain(value);
      expect(adminVisibleText).not.toContain(value);
    }

    const populatedFlightRow = page.locator('table').nth(1)
      .locator(`tr:has-text("${activeOccurrence.flightNumber}"):has-text("1 Active")`).first();
    await expect(populatedFlightRow.locator('text=1 Active')).toBeVisible();
    await expect(populatedFlightRow.locator('text=1 / 180')).toBeVisible();

    // Click Manifest button
    await populatedFlightRow.locator('button:has-text("Manifest")').click();

    // Verify manifest modal opens
    await expect(page.locator('h2:has-text("Passenger Manifest")')).toBeVisible();
    await expect(page.getByText('Manifest Traveler')).toBeVisible();
    const manifestText = await page.getByRole('dialog', { name: 'Passenger Manifest' }).innerText();
    for (const value of restrictedValues) {
      expect(manifestText).not.toContain(value);
    }
    expect(manifestText).not.toContain('Passport');
    expect(manifestText).not.toContain('DOB');

    // Close manifest modal
    await page.locator('button:has-text("Close")').click();
    await expect(page.locator('h2:has-text("Passenger Manifest")')).not.toBeVisible();

    // Select the newly generated flight's live status selector and change to "Delayed"
    const statusSelect = populatedFlightRow.locator('select').first();
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
    await page.goto(`/checkout?outbound=${persistedOccurrence.id}`);
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
    const raceResults = await Promise.allSettled([
      updateFlightSeatingLayout(raceFlight.id, {
        firstClassRows: 4,
        businessRows: 3,
        premiumEconomyRows: 4,
        economyRows: 19,
        seatPattern: 'ABC-DEF'
      }),
      new FlightBookingService().bookFlight({
        flightIds: [raceFlight.id],
        userId: admin.id,
        passengers: [{
          firstName: 'Race',
          lastName: 'Traveler',
          dateOfBirth: '1990-01-01',
          passportNumber: 'E2ERACE123',
          gender: 'Other',
          seatNumbers: ['11A'],
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
