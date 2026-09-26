# Reward Flight Search and Redemption Specification (Phase 5, Issue #130)

**Status**: Draft / Pending Implementation Plan  
**Target Milestone**: Phase 5 (Loyalty & Rewards)  
**Date**: 2026-09-25  

---

## 1. Overview & Context

This specification defines the complete end-to-end reward flight search and loyalty redemption subsystem for Mona Airways, fulfilling **Issue #130: Reward flight search and redemption** (split from #70).

Previously, the flight search form contained an inert, uncontrolled "Search reward flights" checkbox because the application lacked an underlying points economy, award inventory management, and points redemption ledger. Status points were calculated ephemerally from cash bookings in `PointsActivityService`, but there was no spendable points currency, no award chart, no seat availability tracking for award travel, and no mechanism for handling redemptions or point-based cancellation refunds.

This specification introduces:
1. **Spendable Points Ledger**: An append-only, transactional points ledger (`PointsLedgerEntry`) distinct from tier status points, supporting credits (welcome grants, cash flight accrual, cancellation redeposits) and debits (award redemptions).
2. **Dedicated Award Inventory**: Configurable award seat quotas per flight and cabin (`awardSeatsEconomy: 4`, `awardSeatsPremiumEconomy: 2`, `awardSeatsBusiness: 2`, `awardSeatsFirst: 1`), managed alongside physical cabin layouts.
3. **Zone-Based Award Pricing**: A fixed award chart per cabin class plus mandatory non-waivable regulatory taxes and carrier charges ($10.10/passenger-leg) collected via Stripe card checkout.
4. **Reward Search Experience**: Two-way binding for reward flight searches (`?reward=true`), displaying points pricing, tax breakdowns, and remaining award seat badges.
5. **Atomic Checkout Redemption**: Transactional verification of seat holds, award inventory quotas, and user points balance, debiting points and locking award seats simultaneously.
6. **Reward Cancellation & Redeposit**: Cabin-tiered cancellation policies (100% points returned for First/Business; 80% points returned for Economy/Premium Economy before 24h cutoff; 100% on airline disruption) returning points to the ledger and refunding taxes to card.

---

## 2. Requirements & Acceptance Criteria

### Requirements (Issue #130)
- [x] Dedicated spendable points balance with an immutable transactional ledger (`PointsLedgerEntry`).
- [x] Welcome points grants (10,000 pts for new accounts, 50,000 pts for dev/seed accounts) and 5x points per dollar spent on completed cash bookings.
- [x] Dedicated award seat capacity per flight and cabin class.
- [x] Fixed cabin award pricing chart (Economy 15k, Premium Economy 25k, Business 40k, First 60k points per leg) + mandatory cash taxes/fees.
- [x] Interactive "Search reward flights" toggle with URL query parameter sync (`?reward=true`).
- [x] Award availability filtering and badging on search results ("15,000 pts + $10.10 taxes", "2 award seats left", "Sold Out on Points").
- [x] Pre-checkout balance verification, reward fare summary, and Stripe checkout for cash taxes only.
- [x] Concurrency-safe atomic booking execution (`SELECT FOR UPDATE`) decrementing award capacity and debiting user points balance.
- [x] Reward cancellation rules with points redeposit to ledger and cash tax refund via Stripe.
- [x] Customer Profile loyalty dashboard displaying spendable points balance, tier status, and full paginated ledger history.

### Acceptance Criteria
- **Concurrency & Double-Spend Guard**: Two concurrent checkout attempts cannot overdraw a user's points balance or oversell a flight's award seat capacity.
- **Fail-Closed Consistency**: If Stripe payment succeeds but points debit or seat hold fails, the transaction rolls back cleanly and Stripe refund is executed.
- **Transitional Compatibility**: Existing cash booking flows, multi-city itineraries, passenger data encryption, and check-in workflows continue to function with zero regressions.
- **Comprehensive Verification**: All unit tests (`npm run test:unit`), database tests (`npm run test:database`), TypeScript checks (`npx tsc --noEmit`), and linter checks (`npm run lint`) pass with 0 errors.

---

## 3. Data Models & Schema Design

### 3.1 Prisma Schema Additions (`prisma/schema.prisma`)

```prisma
enum PointsTransactionType {
  WELCOME_GRANT       // Initial account grant (e.g. 10,000 signup / 50,000 dev)
  FLIGHT_EARN         // Earned on completed cash flights (5x points per dollar)
  REWARD_REDEMPTION   // Debited when booking an award flight
  REWARD_REFUND       // Redeposited when cancelling an eligible reward booking
  ADMIN_ADJUSTMENT    // Customer support manual adjustment
}

/// Append-only spendable reward points ledger.
model PointsLedgerEntry {
  id           String                @id @default(cuid())
  userId       String
  user         User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  type         PointsTransactionType
  amount       Int                   // Positive for credits, negative for debits
  balanceAfter Int                   // Running spendable balance after this transaction
  bookingId    Int?
  booking      Booking?              @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  description  String
  createdAt    DateTime              @default(now()) @db.Timestamptz(3)

  @@index([userId, createdAt])
  @@index([bookingId])
}

/// Booking model extensions:
model Booking {
  // Existing fields...
  isRewardBooking Boolean @default(false)
  pointsRedeemed  Int?    // Total points debited for this booking (if reward booking)

  pointsLedgerEntries PointsLedgerEntry[]
}

/// Flight award seat allocation:
model Flight {
  // Existing fields...
  /// Dedicated award seat bucket remaining per cabin class
  awardSeatsEconomy         Int @default(4)
  awardSeatsPremiumEconomy  Int @default(2)
  awardSeatsBusiness        Int @default(2)
  awardSeatsFirst           Int @default(1)
}

/// FlightSchedule award seat defaults (for occurrence generation):
model FlightSchedule {
  // Existing fields...
  awardSeatsEconomy         Int @default(4)
  awardSeatsPremiumEconomy  Int @default(2)
  awardSeatsBusiness        Int @default(2)
  awardSeatsFirst           Int @default(1)
}
```

---

## 4. Award Pricing & Chart Architecture (`lib/rewardPricing.ts`)

### 4.1 Fixed Cabin Points Chart
Award flights are priced in points per leg according to cabin class:
- **Economy (`ECONOMY`)**: 15,000 points
- **Premium Economy (`PREMIUM_ECONOMY`)**: 25,000 points
- **Business (`BUSINESS`)**: 40,000 points
- **First (`FIRST`)**: 60,000 points

### 4.2 Mandatory Regulatory Taxes & Fees
Every award flight is subject to non-waivable regulatory security and facility charges:
- **Passenger Facility Charge (PFC)**: $4.50 (450 cents) per passenger-leg
- **September 11th Security Fee**: $5.60 (560 cents) per passenger-leg
- **Total Mandatory Cash Taxes**: $10.10 (1,010 cents) per passenger-leg

### 4.3 Quote Interface & Helper
```typescript
export interface AwardFareQuote {
  cabinClass: CabinClass;
  legCount: number;
  passengerCount: number;
  pointsPerPassengerLeg: number;
  totalPointsRequired: number;
  taxesPerPassengerLegCents: number;
  totalTaxesCents: number;
  formattedPoints: string;
  formattedTaxes: string;
}

export function calculateAwardFareQuote(options: {
  cabinClass: CabinClass;
  legCount: number;
  passengerCount: number;
}): AwardFareQuote;
```

---

## 5. Award Search & Availability Engine

### 5.1 Query URL Parameters (`lib/flightSearchUrl.ts`)
- `FlightSearchCriteria` includes `isRewardSearch?: boolean`.
- `buildFlightSearchUrl` appends `reward=true` when active.
- `parseFlightSearchUrl` parses `searchParams.get('reward') === 'true'`.

### 5.2 Search UI Component (`components/ui/flightBookingForm.tsx`)
- Activates the "Search reward flights" checkbox.
- Binds checkbox state with URL params and passes `isRewardSearch` to search actions.
- Renders reward pricing pills: e.g. `"15,000 pts + $10.10 taxes"` instead of cash fares.
- Displays remaining award availability badges:
  - When `awardSeats <= 2`: `"Only 2 award seats left!"` (Amber badge)
  - When `awardSeats === 0`: `"Sold out on points"` (Disabled / greyed selection)

### 5.3 Server Actions (`app/actions.ts`)
- `searchFlightsAction` and `searchMultiCityFlightsAction`:
  - Accept `isRewardSearch?: boolean`.
  - Attach `awardSeatsAvailable: Record<CabinClass, number>` and `awardQuote` to each returned flight result.

---

## 6. Checkout & Atomic Redemption Transaction

### 6.1 Pre-Checkout Validation & UX (`components/ui/BookingCheckoutWizard.tsx`)
- Verifies traveler's current spendable points balance (`getUserPointsBalanceAction`).
- If `balance < quote.totalPointsRequired`:
  - Renders prominent warning card displaying required points vs available points and shortfall.
  - Offers immediate fallback switch to standard cash booking.
- When balance is sufficient:
  - Summarizes airfare coverage (100% via points).
  - Configures Stripe Elements for the cash tax amount (`totalTaxesCents`).

### 6.2 Atomic Redemption Flow (`lib/FlightBookingService.ts`)
Inside `prisma.$transaction(async (tx) => { ... })`:
1. **Flight Row Locking**: `SELECT ... FROM "Flight" WHERE id IN (...) FOR UPDATE`.
2. **Award Quota Check**: Verifies `flight.awardSeats{Cabin} >= passengerCount` for all itinerary legs.
3. **Seat Hold Consumption**: Validates physical seat holds in `SeatHold` table (`consumeSeatHold`).
4. **Ledger Row Locking & Balance Verification**:
   - Queries latest `PointsLedgerEntry` for `userId` with row lock.
   - Asserts `currentBalance >= totalPointsRequired`, otherwise throws `InsufficientPointsError`.
5. **Inventory Decrement**:
   - Updates `Flight` table decrementing `awardSeats{Cabin}` by `passengerCount`.
6. **Points Ledger Debit**:
   - Inserts `PointsLedgerEntry` with `type: 'REWARD_REDEMPTION'`, negative `amount`, updated `balanceAfter`, and `bookingId`.
7. **Booking Creation**:
   - Creates `Booking` row with `isRewardBooking: true`, `pointsRedeemed: totalPointsRequired`, and `totalPriceCents: totalTaxesCents`.
8. **Passenger & Seat Creation**:
   - Records encrypted traveler PII and seat assignments.
9. **Status Change & Audit**:
   - Inserts `BookingStatusChange` (`CONFIRMED`).

---

## 7. Cancellation & Points Redeposit Policy (`lib/cancellationPolicy.ts`)

### 7.1 Policy Matrix
| Situation | Cabin Class | Points Redeposited | Cash Taxes Refunded |
|---|---|---|---|
| **> 24h Before Departure** | First & Business | **100% of points** (0 points penalty) | 100% of taxes refunded to card |
| **> 24h Before Departure** | Premium Economy & Economy | **80% of points** (20% points penalty) | 100% of taxes refunded to card |
| **< 24h Before Departure** | Any Cabin | **0 points** (forfeited) | 0% (non-refundable) |
| **Airline Disrupted** | Any Cabin | **100% of points** | 100% of taxes refunded to card |
| **Already Departed** | Any Cabin | Refused | Refused |

### 7.2 Transactional Redeposit Action (`app/actions.ts: cancelBookingAction`)
Inside `prisma.$transaction`:
1. Verifies booking is eligible for cancellation under `calculateCancellationOutcome`.
2. If `isRewardBooking`:
   - Calculates points redeposit amount.
   - Inserts `PointsLedgerEntry` with `type: 'REWARD_REFUND'`, positive `amount`, and description.
   - Restores `Flight.awardSeats{Cabin}` by adding `passengerCount` back to the award pool.
   - Triggers Stripe refund for taxes if `refundCents > 0`.
3. Emits `BookingStatusChange` (`CANCELLED`).

---

## 8. Loyalty Dashboard & Profile Integration

### 8.1 Points Service & Balance API (`lib/pointsLedgerService.ts`)
- `getUserSpendablePointsBalance(userId: string): Promise<number>`
- `getPointsLedgerHistory(userId: string, options?: PaginationOptions): Promise<PaginatedLedger>`
- `grantWelcomePointsIfEligible(userId: string): Promise<void>`
- `accruePointsForCashBooking(bookingId: number): Promise<void>` (5x points per dollar spent on completed flights).

### 8.2 Profile Client UI (`components/profile/ProfileClient.tsx`)
- Displays **Spendable Points Balance Card** alongside Tier Status (`Bronze`, `Silver`, `Gold`, `Platinum`).
- Renders interactive points ledger table with date, transaction type badges, description, point change (+/-), and running balance.

---

## 9. Verification & Testing Matrix

### 9.1 Unit Testing
- `__tests__/lib/rewardPricing.test.ts`: Award chart quotes, tax math, single and multi-leg calculations.
- `__tests__/lib/rewardCancellation.test.ts`: 100% vs 80% points redeposit calculations, inside-cutoff forfeiture, disruption exceptions.
- `__tests__/lib/pointsLedgerService.test.ts`: Balance calculations, append-only invariants, welcome grant rules, 5x flight accrual.

### 9.2 Database Integration Testing
- `__tests__/lib/rewardBooking.database.test.ts`:
  - Successful atomic reward booking creation with points debit and award seat decrement.
  - Rejection when user balance is insufficient.
  - Rejection when award seat quota is exhausted (`awardSeatsAvailable = 0`).
  - Concurrent booking race conditions.
- `__tests__/lib/rewardCancellation.database.test.ts`:
  - Full refund for premium cabins before cutoff.
  - 80% refund for standard cabins before cutoff.
  - Award seat replenishment on cancellation.

### 9.3 UI Component Testing
- `__tests__/components/flightBookingFormReward.test.tsx`: "Search reward flights" toggle, query param sync, points pricing cards.
- `__tests__/components/BookingCheckoutWizardReward.test.tsx`: Reward checkout step, balance warning, tax breakdown.
- `__tests__/components/ProfilePointsLedger.test.tsx`: Spendable balance and ledger table rendering.
