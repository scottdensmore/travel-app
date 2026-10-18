import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { flightRouteInclude } from '../lib/flightRoute';
import { createPointsLedgerEntry, grantWelcomePointsIfEligible } from '../lib/pointsLedgerService';
import { registerAndSignIn } from './helpers/auth';
import { completeCheckoutPayment } from './helpers/checkoutPayment';
import { fillOneWayFlightSearch } from './helpers/flightSearch';

test.describe('Reward Flight Search, Redemption & Redeposit Journey', () => {
    const runId = Date.now();
    const password = 'Password123!';
    const createdEmails: string[] = [];
    const modifiedFlightAwardQuotas = new Map<number, number>();

    test.afterAll(async () => {
        for (const [flightId, awardSeatsEconomy] of modifiedFlightAwardQuotas.entries()) {
            try {
                await prisma.flight.update({
                    where: { id: flightId },
                    data: { awardSeatsEconomy },
                });
            } catch (e) {
                console.error('Failed to restore flight award quota in reward-booking.spec.ts:', e);
            }
        }

        for (const email of createdEmails) {
            try {
                const user = await prisma.user.findUnique({
                    where: { email },
                });
                if (!user) continue;

                await prisma.seatHold.deleteMany({
                    where: { holderKey: { contains: user.id } },
                });

                const bookings = await prisma.booking.findMany({
                    where: { userId: user.id },
                });
                for (const booking of bookings) {
                    await prisma.paymentRefundAttempt.deleteMany({
                        where: { paymentRefund: { bookingStatusChange: { bookingId: booking.id } } },
                    });
                    await prisma.paymentRefund.deleteMany({
                        where: { bookingStatusChange: { bookingId: booking.id } },
                    });
                    await prisma.bookingStatusChange.deleteMany({
                        where: { bookingId: booking.id },
                    });
                    await prisma.passengerAncillary.deleteMany({
                        where: { passenger: { bookingId: booking.id } },
                    });
                    await prisma.passenger.deleteMany({
                        where: { bookingId: booking.id },
                    });
                }
                await prisma.pointsLedgerEntry.deleteMany({
                    where: { userId: user.id },
                });
                await prisma.booking.deleteMany({
                    where: { userId: user.id },
                });
                await prisma.paymentAttempt.deleteMany({
                    where: { userId: user.id },
                });
                await prisma.user.delete({
                    where: { id: user.id },
                });
            } catch (e) {
                console.error('Cleanup failed in reward-booking.spec.ts:', e);
            }
        }
    });

    test('Newly registered traveler with 10,000 welcome points sees insufficient points guard on 15,000-point Economy award checkout', async ({ page }, testInfo) => {
        const testEmail = `reward-low-${runId}-${testInfo.testId}@example.com`;
        createdEmails.push(testEmail);
        await registerAndSignIn(page, { name: 'New Loyalty Member', email: testEmail, password });

        const targetFlight = await prisma.flight.findFirstOrThrow({
            where: {
                durationMinutes: { not: null },
                awardSeatsEconomy: { gte: 1 },
                departureDate: {
                    gt: new Date(Date.now() + 72 * 60 * 60 * 1000),
                },
            },
            include: flightRouteInclude,
            orderBy: {
                departureDate: 'asc',
            },
        });

        await page.goto('/');

        // Enable reward flight search toggle
        const rewardCheckbox = page.getByRole('checkbox', { name: /Search reward flights/i });
        await rewardCheckbox.check();
        await expect(rewardCheckbox).toBeChecked();

        await fillOneWayFlightSearch(page, targetFlight);
        await page.click('button:has-text("Find your trip")');
        await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();

        // Verify points pricing pill is rendered instead of cash fare
        const pointsPill = page.getByTestId('award-points-pill').first();
        await expect(pointsPill).toBeVisible();
        await expect(pointsPill).toContainText('15,000 pts + $10.10 taxes');

        const bookLink = page.locator(`a[href*="/checkout?outbound=${targetFlight.id}"][href*="reward=true"]`).first();
        await expect(bookLink).toBeVisible();
        await bookLink.click();

        // Step 1: Verify welcome points (10,000) were automatically granted on checkout and insufficient points warning blocks progression
        await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
        const insufficientWarning = page.getByTestId('insufficient-points-warning');
        await expect(insufficientWarning).toBeVisible();
        await expect(insufficientWarning).toContainText('15,000 points');
        await expect(insufficientWarning).toContainText('10,000 points');

        const selectSeatsButton = page.locator('button:has-text("Select Seats →")');
        await expect(selectSeatsButton).toBeDisabled();
    });

    test('Traveler redeems points + $10.10 taxes for an award flight, inspects ledger on profile, and cancels with 80% points redeposit', async ({ page }, testInfo) => {
        const testEmail = `reward-redeem-${runId}-${testInfo.testId}@example.com`;
        createdEmails.push(testEmail);
        await registerAndSignIn(page, { name: 'Award Flyer', email: testEmail, password });

        const user = await prisma.user.findUniqueOrThrow({
            where: { email: testEmail },
        });
        await grantWelcomePointsIfEligible(user.id);
        await createPointsLedgerEntry({
            userId: user.id,
            type: 'ADMIN_ADJUSTMENT',
            amount: 40_000,
            description: 'Promotional loyalty bonus for E2E reward test',
        });

        const targetFlight = await prisma.flight.findFirstOrThrow({
            where: {
                durationMinutes: { not: null },
                departureDate: {
                    gt: new Date(Date.now() + 96 * 60 * 60 * 1000),
                },
            },
            include: flightRouteInclude,
            orderBy: {
                departureDate: 'desc',
            },
        });

        if (!modifiedFlightAwardQuotas.has(targetFlight.id)) {
            modifiedFlightAwardQuotas.set(targetFlight.id, targetFlight.awardSeatsEconomy);
        }
        await prisma.flight.update({
            where: { id: targetFlight.id },
            data: { awardSeatsEconomy: 2 },
        });

        await page.goto('/');

        // 1. Search with reward flights toggle enabled
        const rewardCheckbox = page.getByRole('checkbox', { name: /Search reward flights/i });
        await rewardCheckbox.check();
        await fillOneWayFlightSearch(page, targetFlight);
        await page.click('button:has-text("Find your trip")');
        await expect(page.locator('h2:has-text("Available Flights")')).toBeVisible();

        await expect(page.getByTestId('award-points-pill').first()).toContainText('15,000 pts + $10.10 taxes');
        await expect(page.getByTestId('award-low-inventory-badge').first()).toContainText('Only 2 award seats left!');

        const bookLink = page.locator(`a[href*="/checkout?outbound=${targetFlight.id}"][href*="reward=true"]`).first();
        await expect(bookLink).toBeVisible();
        await bookLink.click();

        // 2. Step 1: Traveler Information & available balance banner
        await expect(page.locator('h2:has-text("Traveler Information")')).toBeVisible();
        await expect(page.getByTestId('spendable-points-balance')).toContainText('Available balance: 50,000 pts');

        await page.fill('input[placeholder="John"]', 'Elena');
        await page.fill('input[placeholder="Doe"]', 'Rostova');
        await page.fill('input[type="date"]', '1988-07-19');
        await page.fill('input[placeholder="A00000000"]', 'R98765432');
        await page.click('button:has-text("Select Seats →")');

        // 3. Step 2: Seat Selection
        await expect(page.locator('h2:has-text("Select Your Seats")')).toBeVisible();
        await page.locator('button[title^="Select Seat"]').first().click();
        await page.click('button:has-text("Continue to Bags & Extras →")');

        // 4. Step 3: Bags & Extras (no extras, only mandatory taxes)
        await expect(page.locator('h2:has-text("Bags & Travel Extras")')).toBeVisible();
        await page.click('button:has-text("Continue to Review & Payment →")');

        // 5. Step 4: Review & Payment
        await expect(page.locator('h2:has-text("Review Booking")')).toBeVisible();
        await expect(page.getByTestId('spendable-points-balance-step4')).toContainText('Available balance: 50,000 pts');
        await expect(page.locator('text=Points Redemption')).toBeVisible();
        await expect(page.locator('text=15,000 pts').first()).toBeVisible();
        await expect(page.locator('text=Mandatory Taxes & Fees')).toBeVisible();
        await expect(page.locator('text=$10.10').first()).toBeVisible();

        await completeCheckoutPayment(page);

        // 6. Step 5: Confirmation
        await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 15_000 });

        // Verify database state after redemption
        const persistedBooking = await prisma.booking.findFirstOrThrow({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
        });
        expect(persistedBooking.isRewardBooking).toBe(true);
        expect(persistedBooking.pointsRedeemed).toBe(15_000);
        expect(persistedBooking.totalPriceCents).toBe(1010);

        const flightAfterBooking = await prisma.flight.findUniqueOrThrow({
            where: { id: targetFlight.id },
        });
        expect(flightAfterBooking.awardSeatsEconomy).toBe(1);

        // 7. Navigate to /profile and verify spendable balance and Points Activity History table
        await page.goto('/profile');
        await expect(page.getByTestId('spendable-points-balance')).toContainText('35,000 pts');
        await expect(page.getByTestId('points-ledger-table')).toBeVisible();
        await expect(page.getByTestId('badge-REWARD_REDEMPTION').first()).toHaveText('Redemption');
        await expect(page.getByTestId('points-ledger-table')).toContainText('-15,000');

        // 8. Cancel the reward booking from /profile (>24h before departure: 80% Economy points redeposited + 100% taxes refunded)
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('Are you sure you want to cancel booking for flight');
            await dialog.accept();
        });
        await page.click('button:has-text("Cancel")');

        const cancellationStatus = page.getByRole('status').filter({
            hasText: 'Booking cancelled. Any refund due will appear in the status column.',
        });
        await expect(cancellationStatus).toBeVisible();
        await expect(page.getByTestId(/^booking-status-/).first()).toContainText('Cancelled');

        // Reload /profile to verify updated spendable balance (35,000 + 12,000 = 47,000 pts) and REWARD_REFUND ledger row
        await page.reload();
        await expect(page.getByTestId('spendable-points-balance')).toContainText('47,000 pts');
        await expect(page.getByTestId('badge-REWARD_REFUND').first()).toHaveText('Refund');
        await expect(page.getByTestId('points-ledger-table')).toContainText('+12,000');

        // Verify award seat inventory replenished back to 2 and 100% tax refund succeeded
        const flightAfterCancel = await prisma.flight.findUniqueOrThrow({
            where: { id: targetFlight.id },
        });
        expect(flightAfterCancel.awardSeatsEconomy).toBe(2);

        const taxRefund = await prisma.paymentRefund.findFirstOrThrow({
            where: { bookingStatusChange: { bookingId: persistedBooking.id } },
        });
        expect(taxRefund.amountCents).toBe(1010);
        expect(taxRefund.status).toBe('SUCCEEDED');
    });
});
