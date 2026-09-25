# Reward Flight Search and Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full reward flight search, award seat quota management, points pricing chart, atomic checkout redemption, points-aware cancellation refunds, and customer loyalty dashboard for Issue #130.

**Architecture:** Extend Prisma schema with an append-only `PointsLedgerEntry` model, per-flight cabin award seat allocations, and booking reward fields. Add a domain-level award pricing service (`lib/rewardPricing.ts`), wire reward search criteria into URL routing and search actions, execute atomic booking transactions with row-level locking on flights and points ledgers, extend cancellation policies to redeposit points, and build profile points dashboard components.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript 5, Prisma 5 (PostgreSQL), Stripe API, Tailwind CSS, Jest, React Testing Library.

**Spec:** [`docs/superpowers/specs/2026-09-25-reward-flight-redemption-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/.worktrees/feat-reward-flight-redemption-130/docs/superpowers/specs/2026-09-25-reward-flight-redemption-design.md)

## Global Constraints

- Runtime: Node.js 22 baseline enforced with `.npmrc` `engine-strict=true`.
- Zero test/build tooling in production `dependencies`.
- Mandatory migration timeout: Every migration SQL script MUST contain `SET LOCAL lock_timeout = '3s';`.
- Concurrency & Double-Spend Guard: Row-level locking (`SELECT FOR UPDATE`) on flights and user points ledger inside transactions.
- Zero Regressions: TypeScript (`npx tsc --noEmit`), ESLint (`npm run lint`), unit tests (`npm run test:unit`), and database tests (`npm run test:database`) must stay green.

---

### Task 1: Schema Migration, Award Inventory & Occurrence Propagation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260925120000_reward_flight_redemption/migration.sql`
- Modify: `prisma/seed.ts:50-100`
- Modify: `lib/FlightScheduleService.ts:180-260`
- Test: `__tests__/lib/flightScheduleAwardCapacity.test.ts`
- Test: `__tests__/lib/airports.database.test.ts`

**Interfaces:**
- Consumes: Existing `FlightSchedule`, `Flight`, `User`, `Booking` models.
- Produces: `PointsTransactionType`, `PointsLedgerEntry`, `Booking.isRewardBooking`, `Booking.pointsRedeemed`, `Flight.awardSeats{Cabin}`, `FlightSchedule.awardSeats{Cabin}`.

- [ ] **Step 1: Write failing unit test for FlightScheduleService award seat propagation**

```typescript
// __tests__/lib/flightScheduleAwardCapacity.test.ts
import FlightScheduleService from '@/lib/FlightScheduleService';
import { prisma } from '@/lib/prisma';

describe('FlightScheduleService award seat propagation', () => {
    it('propagates custom award seat quotas from schedule to generated flight occurrences', async () => {
        const service = new FlightScheduleService();
        const schedule = {
            id: 999,
            flightNumber: 'MO101',
            airline: 'Mona Airways',
            from: 'SEA',
            to: 'JFK',
            departureTime: '08:00',
            durationMinutes: 300,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            priceCents: 25000,
            isActive: true,
            awardSeatsEconomy: 6,
            awardSeatsPremiumEconomy: 3,
            awardSeatsBusiness: 2,
            awardSeatsFirst: 1,
        };

        const flightData = (service as any).buildFlightFromSchedule(schedule, new Date('2026-10-01T08:00:00Z'));
        expect(flightData.awardSeatsEconomy).toBe(6);
        expect(flightData.awardSeatsPremiumEconomy).toBe(3);
        expect(flightData.awardSeatsBusiness).toBe(2);
        expect(flightData.awardSeatsFirst).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/flightScheduleAwardCapacity.test.ts`  
Expected: FAIL with missing properties or undefined method/schema fields.

- [ ] **Step 3: Update `prisma/schema.prisma` and generate migration**

Add to `prisma/schema.prisma`:
```prisma
enum PointsTransactionType {
  WELCOME_GRANT
  FLIGHT_EARN
  REWARD_REDEMPTION
  REWARD_REFUND
  ADMIN_ADJUSTMENT
}

model PointsLedgerEntry {
  id           String                @id @default(cuid())
  userId       String
  user         User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  type         PointsTransactionType
  amount       Int
  balanceAfter Int
  bookingId    Int?
  booking      Booking?              @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  description  String
  createdAt    DateTime              @default(now()) @db.Timestamptz(3)

  @@index([userId, createdAt])
  @@index([bookingId])
}

// In model Booking:
  isRewardBooking Boolean @default(false)
  pointsRedeemed  Int?
  pointsLedgerEntries PointsLedgerEntry[]

// In model Flight:
  awardSeatsEconomy         Int @default(4)
  awardSeatsPremiumEconomy  Int @default(2)
  awardSeatsBusiness        Int @default(2)
  awardSeatsFirst           Int @default(1)

// In model FlightSchedule:
  awardSeatsEconomy         Int @default(4)
  awardSeatsPremiumEconomy  Int @default(2)
  awardSeatsBusiness        Int @default(2)
  awardSeatsFirst           Int @default(1)
```

Create migration with `SET LOCAL lock_timeout = '3s';` prepended:
`npx prisma migrate dev --name reward_flight_redemption --create-only`
Edit migration SQL to ensure `SET LOCAL lock_timeout = '3s';` is on line 1, then apply with `npx prisma migrate deploy`.

- [ ] **Step 4: Update `lib/FlightScheduleService.ts` and `prisma/seed.ts`**

In `lib/FlightScheduleService.ts`, copy `awardSeatsEconomy`, `awardSeatsPremiumEconomy`, `awardSeatsBusiness`, and `awardSeatsFirst` when instantiating flight rows.
In `prisma/seed.ts`, seed initial `PointsLedgerEntry` rows (50,000 pts welcome grant for dev users, 10,000 for standard user).

- [ ] **Step 5: Run tests to verify pass**

Run: `npx jest __tests__/lib/flightScheduleAwardCapacity.test.ts`  
Run: `npm run verify:repo`  
Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add prisma/ lib/FlightScheduleService.ts __tests__/lib/flightScheduleAwardCapacity.test.ts
git commit -m "feat(schema): add points ledger and flight award inventory models (#130)"
```

---

### Task 2: Points Ledger Domain Service & Accrual Engine

**Files:**
- Create: `lib/pointsLedgerService.ts`
- Test: `__tests__/lib/pointsLedgerService.test.ts`
- Test: `__tests__/lib/pointsLedger.database.test.ts`

**Interfaces:**
- Consumes: `prisma.pointsLedgerEntry`, `prisma.user`, `prisma.booking`.
- Produces:
  - `getUserSpendablePointsBalance(userId: string, tx?: PrismaClient): Promise<number>`
  - `createPointsLedgerEntry(input: PointsLedgerInput, tx: PrismaClient): Promise<PointsLedgerEntry>`
  - `grantWelcomePointsIfEligible(userId: string, tx?: PrismaClient): Promise<number>`
  - `accruePointsForCashBooking(bookingId: number, tx?: PrismaClient): Promise<number>`
  - `getPointsLedgerHistory(userId: string, options?: { page?: number; pageSize?: number }): Promise<PaginatedLedger>`

- [ ] **Step 1: Write failing unit test for `pointsLedgerService`**

```typescript
// __tests__/lib/pointsLedgerService.test.ts
import { calculatePointsAccrualForFare } from '@/lib/pointsLedgerService';

describe('pointsLedgerService', () => {
    it('calculates 5x points per dollar spent on cash airfare', () => {
        // $250.00 ticket = 25,000 cents -> 1,250 points
        expect(calculatePointsAccrualForFare(25000)).toBe(1250);
        // $99.99 ticket = 9,999 cents -> 495 points (floored to dollar)
        expect(calculatePointsAccrualForFare(9999)).toBe(495);
        expect(calculatePointsAccrualForFare(0)).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/pointsLedgerService.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `lib/pointsLedgerService.ts`**

```typescript
// lib/pointsLedgerService.ts
import { Prisma, PrismaClient, PointsTransactionType } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

export const WELCOME_POINTS_NEW_USER = 10000;
export const WELCOME_POINTS_DEV_USER = 50000;
export const POINTS_EARN_MULTIPLIER_PER_DOLLAR = 5;

export function calculatePointsAccrualForFare(totalPriceCents: number): number {
    if (totalPriceCents <= 0) return 0;
    const dollars = Math.floor(totalPriceCents / 100);
    return dollars * POINTS_EARN_MULTIPLIER_PER_DOLLAR;
}

export class InsufficientPointsError extends Error {
    constructor(public readonly required: number, public readonly available: number) {
        super(`Insufficient reward points: ${required} required, ${available} available.`);
        this.name = 'InsufficientPointsError';
    }
}

export async function getUserSpendablePointsBalance(
    userId: string,
    tx: Prisma.TransactionClient | PrismaClient = defaultPrisma
): Promise<number> {
    const latest = await tx.pointsLedgerEntry.findFirst({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { balanceAfter: true },
    });
    return latest?.balanceAfter ?? 0;
}

export async function createPointsLedgerEntry(
    input: {
        userId: string;
        type: PointsTransactionType;
        amount: number;
        description: string;
        bookingId?: number | null;
    },
    tx: Prisma.TransactionClient
): Promise<PointsLedgerEntry> {
    // Lock latest user ledger entry to serialize balance updates
    const currentBalance = await getUserSpendablePointsBalance(input.userId, tx);
    const balanceAfter = currentBalance + input.amount;

    if (balanceAfter < 0) {
        throw new InsufficientPointsError(Math.abs(input.amount), currentBalance);
    }

    return tx.pointsLedgerEntry.create({
        data: {
            userId: input.userId,
            type: input.type,
            amount: input.amount,
            balanceAfter,
            description: input.description,
            bookingId: input.bookingId ?? null,
        },
    });
}
```

- [ ] **Step 4: Write database test and verify transactions**

Create `__tests__/lib/pointsLedger.database.test.ts` testing balance creation, double-spend prevention, welcome grants, and 5x accrual.

- [ ] **Step 5: Run tests and verify**

Run: `npx jest __tests__/lib/pointsLedgerService.test.ts`  
Run: `npm run test:database -- -t "pointsLedger"`  
Run: `npx tsc --noEmit && npm run lint`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/pointsLedgerService.ts __tests__/lib/pointsLedger*
git commit -m "feat(loyalty): implement spendable points ledger service and accrual engine (#130)"
```

---

### Task 3: Award Pricing Chart & Search Engine Criteria

**Files:**
- Create: `lib/rewardPricing.ts`
- Modify: `lib/flightSearchUrl.ts:1-80`
- Modify: `app/actions.ts:200-350`
- Test: `__tests__/lib/rewardPricing.test.ts`
- Test: `__tests__/lib/flightSearchUrlReward.test.ts`

**Interfaces:**
- Consumes: `CabinClass`, `Flight`, `FlightSearchCriteria`.
- Produces:
  - `calculateAwardFareQuote(options: { cabinClass: CabinClass; legCount: number; passengerCount: number }): AwardFareQuote`
  - `isAwardAvailableForFlight(flight: Flight, cabin: CabinClass, passengerCount: number): boolean`
  - `searchFlightsAction(..., isRewardSearch?: boolean)` returns `awardQuote` and `awardAvailable`.

- [ ] **Step 1: Write failing unit test for `rewardPricing.ts`**

```typescript
// __tests__/lib/rewardPricing.test.ts
import { calculateAwardFareQuote, CABIN_AWARD_POINTS, MANDATORY_AWARD_TAX_CENTS_PER_LEG } from '@/lib/rewardPricing';

describe('rewardPricing', () => {
    it('computes exact points and mandatory taxes for single-leg economy flight', () => {
        const quote = calculateAwardFareQuote({
            cabinClass: 'ECONOMY',
            legCount: 1,
            passengerCount: 1,
        });

        expect(quote.totalPointsRequired).toBe(15000);
        expect(quote.totalTaxesCents).toBe(1010); // $10.10
        expect(quote.formattedPoints).toBe('15,000 pts');
        expect(quote.formattedTaxes).toBe('$10.10');
    });

    it('scales points and taxes linearly for round-trip business with 2 passengers', () => {
        const quote = calculateAwardFareQuote({
            cabinClass: 'BUSINESS',
            legCount: 2,
            passengerCount: 2,
        });

        // 40,000 pts * 2 legs * 2 passengers = 160,000 pts
        expect(quote.totalPointsRequired).toBe(160000);
        // 1010 cents * 2 legs * 2 passengers = 4040 cents ($40.40)
        expect(quote.totalTaxesCents).toBe(4040);
        expect(quote.formattedTaxes).toBe('$40.40');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/rewardPricing.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `lib/rewardPricing.ts`**

Implement fixed award points map (`ECONOMY: 15000`, `PREMIUM_ECONOMY: 25000`, `BUSINESS: 40000`, `FIRST: 60000`), PFC & security taxes ($10.10/leg), and availability predicate `isAwardAvailableForFlight`.

- [ ] **Step 4: Update `lib/flightSearchUrl.ts` & `app/actions.ts`**

Add `isRewardSearch?: boolean` to `FlightSearchCriteria`. Parse and build `?reward=true`.
In `app/actions.ts`, attach `awardQuote` and remaining award seats count to returned flight search results.

- [ ] **Step 5: Run tests and verify**

Run: `npx jest __tests__/lib/rewardPricing.test.ts`  
Run: `npx jest __tests__/lib/flightSearchUrlReward.test.ts`  
Run: `npx tsc --noEmit && npm run lint`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/rewardPricing.ts lib/flightSearchUrl.ts app/actions.ts __tests__/lib/rewardPricing.test.ts
git commit -m "feat(pricing): add award chart and search action points pricing (#130)"
```

---

### Task 4: Search UI — Interactive Reward Flights Toggle & Badging

**Files:**
- Modify: `components/ui/flightBookingForm.tsx:1-500`
- Test: `__tests__/components/flightBookingFormReward.test.tsx`

**Interfaces:**
- Consumes: `isRewardSearch` query parameter, `AwardFareQuote`, `flight.awardSeats{Cabin}`.
- Produces:
  - Controlled "Search reward flights" checkbox.
  - Search results showing points pill ("15,000 pts + $10.10 taxes") when reward search is enabled.
  - Remaining award seat badge ("Only 2 award seats left!").
  - "Sold Out on Points" disabled button when award inventory is 0.

- [ ] **Step 1: Write failing component test for reward search toggle**

```typescript
// __tests__/components/flightBookingFormReward.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FlightBookingForm from '@/components/ui/flightBookingForm';

describe('FlightBookingForm reward search toggle', () => {
    it('renders the Search reward flights checkbox and updates search criteria', () => {
        render(<FlightBookingForm />);
        const rewardCheckbox = screen.getByLabelText(/search reward flights/i);
        expect(rewardCheckbox).not.toBeChecked();

        fireEvent.click(rewardCheckbox);
        expect(rewardCheckbox).toBeChecked();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/flightBookingFormReward.test.tsx`  
Expected: FAIL if checkbox is uncontrolled or missing.

- [ ] **Step 3: Update `components/ui/flightBookingForm.tsx`**

1. Bind `isRewardSearch` to state, initialized from `initialSearch?.isRewardSearch ?? false`.
2. Sync `isRewardSearch` in URL updates using `buildFlightSearchUrl`.
3. In flight search result cards, if `isRewardSearch` is true:
   - Render points price and mandatory tax pill.
   - Render award availability badge:
     - `awardSeats <= 2 && awardSeats > 0`: Amber warning pill ("Only X award seats left!").
     - `awardSeats === 0`: Grey badge ("Sold out on points") with disabled selection.

- [ ] **Step 4: Run component tests and full unit tests**

Run: `npx jest __tests__/components/flightBookingFormReward.test.tsx`  
Run: `npm run test:unit -- -t "FlightBookingForm"`  
Run: `npx tsc --noEmit && npm run lint`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/ui/flightBookingForm.tsx __tests__/components/flightBookingFormReward.test.tsx
git commit -m "feat(ui): connect reward flight search toggle and points pricing cards (#130)"
```

---

### Task 5: Atomic Reward Checkout & Redemption Transaction

**Files:**
- Modify: `lib/FlightBookingService.ts:130-310`
- Modify: `app/actions/paymentActions.ts:1-120` (or `app/actions.ts` PaymentIntent actions)
- Modify: `components/ui/BookingCheckoutWizard.tsx:1-400`
- Test: `__tests__/lib/rewardBooking.database.test.ts`
- Test: `__tests__/components/BookingCheckoutWizardReward.test.tsx`

**Interfaces:**
- Consumes: `FlightBookingService`, `PointsLedgerEntry`, `consumeSeatHold`, `PaymentIntent`.
- Produces:
  - Atomic reward booking creation: decrements `Flight.awardSeats{Cabin}`, debits user points ledger, charges taxes on Stripe.
  - Pre-checkout validation of points balance with warning banner on shortfall.

- [ ] **Step 1: Write failing database test for reward booking transaction**

```typescript
// __tests__/lib/rewardBooking.database.test.ts
import FlightBookingService from '@/lib/FlightBookingService';
import { prisma } from '@/lib/prisma';
import { createPointsLedgerEntry } from '@/lib/pointsLedgerService';

describe('FlightBookingService reward redemption', () => {
    it('atomically debits user points, decrements award capacity, and records reward booking', async () => {
        // Setup user with 50,000 points and a flight with 4 award seats
        // Call bookFlight with isRewardBooking: true
        // Verify points balance is now 35,000
        // Verify flight awardSeatsEconomy is now 3
        // Verify booking.isRewardBooking is true and pointsRedeemed is 15000
    });

    it('rejects booking when user has insufficient points without modifying inventory', async () => {
        // Setup user with only 5,000 points
        // Call bookFlight for 15,000 point flight
        // Expect InsufficientPointsError
        // Verify flight awardSeatsEconomy is unchanged
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:database -- -t "reward redemption"`  
Expected: FAIL with unimplemented reward booking logic.

- [ ] **Step 3: Update `lib/FlightBookingService.ts` and Stripe Payment Actions**

1. In `FlightBookingService.bookFlight`:
   - If `isRewardBooking`:
     - Lock flights via `SELECT FOR UPDATE`.
     - Check `flight.awardSeats{Cabin} >= passengerCount`.
     - Decrement `flight.awardSeats{Cabin}`.
     - Call `createPointsLedgerEntry` with `type: 'REWARD_REDEMPTION'`, negative points amount.
     - Create `Booking` with `isRewardBooking: true`, `pointsRedeemed`, and `totalPriceCents: taxesCents`.
2. In `createPaymentIntentAction`:
   - If `isRewardBooking`: set amount to mandatory taxes and fees (`taxesCents`).
3. In `components/ui/BookingCheckoutWizard.tsx`:
   - Fetch user spendable points balance.
   - Show points redemption summary and card payment for taxes.
   - Show warning and disable proceed button if balance is insufficient.

- [ ] **Step 4: Run tests and verify**

Run: `npm run test:database -- -t "reward redemption"`  
Run: `npx jest __tests__/components/BookingCheckoutWizardReward.test.tsx`  
Run: `npx tsc --noEmit && npm run lint`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/FlightBookingService.ts app/actions/ components/ui/BookingCheckoutWizard.tsx __tests__/
git commit -m "feat(checkout): implement atomic reward points redemption and tax payment (#130)"
```

---

### Task 6: Cancellation Policy, Points Redeposit, & Profile Loyalty UI

**Files:**
- Modify: `lib/cancellationPolicy.ts:1-150`
- Modify: `app/actions.ts:700-850` (`cancelBookingAction`)
- Modify: `components/profile/ProfileClient.tsx:1-350`
- Modify: `app/profile/page.tsx:1-100`
- Test: `__tests__/lib/rewardCancellation.test.ts`
- Test: `__tests__/lib/rewardCancellation.database.test.ts`
- Test: `__tests__/components/ProfilePointsLedger.test.tsx`

**Interfaces:**
- Consumes: `CancellableBooking`, `cancelBookingAction`, `PointsLedgerEntry`.
- Produces:
  - `calculateCancellationOutcome` calculates `pointsRedeposited` (100% First/Business, 80% Economy/PE, 100% Disrupted).
  - `cancelBookingAction` atomically redeposits points via `PointsLedgerEntry` (`REWARD_REFUND`), replenishes `Flight.awardSeats{Cabin}`, and refunds card taxes.
  - Profile client displays spendable points balance and transaction history table.

- [ ] **Step 1: Write failing unit test for reward cancellation policy**

```typescript
// __tests__/lib/rewardCancellation.test.ts
import { calculateCancellationOutcome } from '@/lib/cancellationPolicy';

describe('reward cancellation policy', () => {
    it('returns 100% points for First and Business cabin before 24h cutoff', () => {
        const outcome = calculateCancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 40000,
            totalPriceCents: 1010,
            departsAt: new Date(Date.now() + 48 * 3600 * 1000),
            legFareCents: [25000],
            cabins: ['BUSINESS'],
        });

        expect(outcome.allowed).toBe(true);
        expect(outcome.pointsRedeposited).toBe(40000);
        expect(outcome.refundCents).toBe(1010);
    });

    it('returns 80% points for Economy cabin before 24h cutoff with 20% penalty', () => {
        const outcome = calculateCancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 15000,
            totalPriceCents: 1010,
            departsAt: new Date(Date.now() + 48 * 3600 * 1000),
            legFareCents: [15000],
            cabins: ['ECONOMY'],
        });

        expect(outcome.allowed).toBe(true);
        expect(outcome.pointsRedeposited).toBe(12000); // 80% of 15,000
        expect(outcome.refundCents).toBe(1010);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/rewardCancellation.test.ts`  
Expected: FAIL with missing `pointsRedeposited`.

- [ ] **Step 3: Update `lib/cancellationPolicy.ts` and `cancelBookingAction`**

1. In `lib/cancellationPolicy.ts`: Calculate `pointsRedeposited` based on cabin and cutoff.
2. In `cancelBookingAction` in `app/actions.ts`:
   - If `outcome.pointsRedeposited > 0`: Call `createPointsLedgerEntry` with `type: 'REWARD_REFUND'`.
   - Replenish `Flight.awardSeats{Cabin}` by adding back `passengerCount`.
   - Issue Stripe refund for `outcome.refundCents`.
3. In `components/profile/ProfileClient.tsx`:
   - Render Spendable Points Card and paginated Points Activity History table.

- [ ] **Step 4: Run tests and verify**

Run: `npx jest __tests__/lib/rewardCancellation.test.ts`  
Run: `npm run test:database -- -t "rewardCancellation"`  
Run: `npx jest __tests__/components/ProfilePointsLedger.test.tsx`  
Run: `npm run test:unit`  
Run: `npx tsc --noEmit && npm run lint`  
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/cancellationPolicy.ts app/actions.ts components/profile/ __tests__/
git commit -m "feat(loyalty): implement reward cancellation redeposit and profile points dashboard (#130)"
```
