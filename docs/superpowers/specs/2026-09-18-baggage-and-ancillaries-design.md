# Baggage & Travel Ancillaries Selection Specification

**Status:** Approved  
**Date:** 2026-09-18  
**Author:** Antigravity / Pair Programming with Scott Densmore  
**Target Issue:** [#350 (feat(checkout): add baggage selection and travel ancillaries to booking wizard)](https://github.com/scottdensmore/travel-app/issues/350)  

---

## 1. Executive Summary & Problem Statement

In commercial aviation, bookings routinely include ancillary revenue products: checked baggage, carry-on bags, priority boarding, and special assistance. Currently, the checkout flow in `travel-app` jumps directly from seat map selection to payment authorization with zero baggage or ancillary options.

This specification details the end-to-end architecture, database schema, authoritative server pricing, checkout wizard experience, and boarding pass / confirmation integration for passenger baggage and travel ancillaries.

---

## 2. Core Domain Rules & Cabin Allowances

Ancillary allowances and pricing are deterministic and cabin-aware. Pricing is authoritative on the server and cannot be forged by client tampering.

### 2.1 Pricing Matrix

| Ancillary Option | Enum Key | Economy | Premium Economy | Business | First |
|---|---|---|---|---|---|
| **Carry-On Bag** | `CARRY_ON` | Free ($0) | Free ($0) | Free ($0) | Free ($0) |
| **1st Checked Bag** | `CHECKED_BAG_1` | $35 (3,500¢) | Free ($0) | Free ($0) | Free ($0) |
| **2nd Checked Bag** | `CHECKED_BAG_2` | $45 (4,500¢) | $45 (4,500¢) | Free ($0) | Free ($0) |
| **Priority Boarding** | `PRIORITY_BOARDING` | $15 (1,500¢) | $15 (1,500¢) | Included ($0) | Included ($0) |
| **Special Assistance** | `SPECIAL_ASSISTANCE` | Free ($0) | Free ($0) | Free ($0) | Free ($0) |

### 2.2 Domain Invariants & Rules

1. **Selection Scope:** Ancillaries are selected per passenger and apply to the entire booked trip (one-way, round-trip, or multi-city stopover).
2. **Prerequisite Dependency:** A passenger cannot select a **2nd Checked Bag** (`CHECKED_BAG_2`) without having selected a **1st Checked Bag** (`CHECKED_BAG_1`).
3. **Cabin Inclusion Handling:** If an item is complimentary or included in the passenger's booked cabin class (e.g. 2 bags for Business/First), the ancillary record is created with `priceCents = 0`. The UI marks it as `"Included with your cabin"`.
4. **Authoritative Total Calculation:**
   $$\text{Total Amount} = \text{Base Airfare} + \text{Seat Surcharges} + \sum \text{Passenger Ancillary Fees}$$
5. **Cancellation & Refund Guarantee:** If a booking is cancelled within the allowable refund window or disrupted by the airline, the full captured amount (`totalPriceCents`), which includes all ancillary fees, is refunded via Stripe.

---

## 3. Data Model & Database Migration

### 3.1 Prisma Schema

Add `AncillaryType` enum and `PassengerAncillary` model in [`prisma/schema.prisma`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/prisma/schema.prisma):

```prisma
enum AncillaryType {
  CARRY_ON
  CHECKED_BAG_1
  CHECKED_BAG_2
  PRIORITY_BOARDING
  SPECIAL_ASSISTANCE
}

model PassengerAncillary {
  id          String        @id @default(cuid())
  passengerId String
  passenger   Passenger     @relation(fields: [passengerId], references: [id], onDelete: Cascade)
  type        AncillaryType
  priceCents  Int           // Minor units in currency (e.g. 3500 for $35.00, 0 for included)
  createdAt   DateTime      @default(now())

  @@unique([passengerId, type])
  @@index([passengerId])
}
```

Update the `Passenger` model to include the relation:
```prisma
model Passenger {
  // ... existing fields
  ancillaries PassengerAncillary[]
}
```

### 3.2 Migration Script
Generate migration `20260918200000_add_passenger_ancillaries`:
- Creates enum `"AncillaryType"`.
- Creates table `"PassengerAncillary"` with foreign key cascade to `"Passenger"`.
- Creates unique index on `("passengerId", "type")`.
- Enforces strict `SET LOCAL lock_timeout = '3s';` per migration standards.

---

## 4. Server Actions & Pricing Architecture

### 4.1 `lib/bookingPricing.ts`
Export pricing calculation functions:
```ts
export function getAncillaryPriceCents(type: AncillaryType, cabin: CabinClass): number;
export function calculatePassengerAncillaries(
    cabin: CabinClass,
    types: AncillaryType[]
): { items: Array<{ type: AncillaryType; priceCents: number }>; totalCents: number };
export function calculateBookingTotalCents(
    baseAirfareCents: number,
    seatSurchargesCents: number,
    passengersAncillaries: Array<{ cabin: CabinClass; types: AncillaryType[] }>
): number;
```

### 4.2 Validation in `lib/validation.ts`
Export Zod schemas:
```ts
export const ancillaryTypeSchema = z.enum([
    'CARRY_ON',
    'CHECKED_BAG_1',
    'CHECKED_BAG_2',
    'PRIORITY_BOARDING',
    'SPECIAL_ASSISTANCE',
]);

export const passengerAncillariesSchema = z.array(ancillaryTypeSchema).refine(
    (types) => {
        // Enforce: CHECKED_BAG_2 requires CHECKED_BAG_1
        if (types.includes('CHECKED_BAG_2') && !types.includes('CHECKED_BAG_1')) {
            return false;
        }
        return true;
    },
    { message: 'A first checked bag must be selected before adding a second checked bag.' }
);

export const bookingAncillariesMapSchema = z.record(
    z.string(), // passenger index string '0', '1', etc.
    passengerAncillariesSchema
);
```

### 4.3 Payment Fingerprint Binding
In [`app/actions.ts`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/app/actions.ts), update `createPaymentAttemptAction`:
- Compute `totalAmountCents` including all passenger ancillaries.
- Bind the request fingerprint to the ancillary selections:
  ```ts
  const fingerprintPayload = {
      flightIds: sortedFlightIds,
      seats: sortedSeatHoldIds,
      cabin: cabinClass,
      ancillaries: passengers.map((p, idx) => ({
          passengerIndex: idx,
          types: (ancillariesByPassenger[idx] || []).slice().sort()
      }))
  };
  ```
- If ancillary selections change in the wizard, the existing uncaptured `PaymentAttempt` is invalidated and recreated.

### 4.4 Booking Persistence in `FlightBookingService.ts`
Extend `bookFlight` to receive `ancillariesByPassenger`:
- Batch insert `PassengerAncillary` records inside the booking `$transaction`:
  ```ts
  const ancillaryInserts = [];
  for (let i = 0; i < passengers.length; i++) {
      const passengerRecord = createdPassengers[i];
      const selectedTypes = ancillariesByPassenger[i] || [];
      for (const type of selectedTypes) {
          const priceCents = getAncillaryPriceCents(type, cabinClass);
          ancillaryInserts.push({
              passengerId: passengerRecord.id,
              type,
              priceCents,
          });
      }
  }
  if (ancillaryInserts.length > 0) {
      await tx.passengerAncillary.createMany({ data: ancillaryInserts });
  }
  ```

---

## 5. Checkout Wizard Experience (`BookingCheckoutWizard.tsx`)

### 5.1 Step Progression
Expand `step` from `1 | 2 | 3 | 4` to `1 | 2 | 3 | 4 | 5`:
1. **Travelers**: Personal details (name, DOB, passport).
2. **Seats**: Interactive seat map selection per leg.
3. **Bags & Extras**: Per-passenger ancillary option cards with live subtotal.
4. **Review & Payment**: Authoritative order summary, hold timer, and Stripe card authorization.
5. **Confirmation**: Booking reference, receipt, and boarding pass handoff.

### 5.2 Step 3 UI Layout & Cards
- **Passenger Selector**: Tab or stacked cards for multi-passenger bookings (`Passenger 1: Alice Walker`, `Passenger 2: Bob Walker`).
- **Ancillary Cards**:
  - `Carry-On Bag`: Shows `"Included (1 overhead bag + 1 personal item)"`.
  - `1st Checked Bag`: Displays `$35` (or `"Included with your cabin"` for Premium Economy, Business, First).
  - `2nd Checked Bag`: Displays `$45` (or `"Included with your cabin"` for Business, First). Disabled if 1st bag is unselected.
  - `Priority Boarding`: Displays `$15` (or `"Included with your cabin"` for Business, First).
  - `Special Assistance`: Accessible option for wheelchair or mobility assistance ($0).
- **Running Price Callout**: Live ancillary subtotal badge.
- **Accessibility & Responsiveness**:
  - Semantic form labels, `aria-pressed` / `role="checkbox"`, full keyboard navigation (`Enter` / `Space`).
  - Strict zero horizontal overflow across 320px, 390px, 768px, and 1280px viewports.

---

## 6. Confirmation & Boarding Pass Enrichment

1. **Confirmation Receipt (`BookingConfirmation.tsx`) & Profile (`ProfileClient.tsx`)**:
   - Displays itemized line items: `Airfare`, `Seats`, and `Bags & Extras`.
   - Lists selected extras per traveler.
2. **Check-In Boarding Pass (`CheckInPanel.tsx` & `travelDocumentEmail.ts`)**:
   - Displays `BAGS: {count}` on the barcode boarding card.
   - If `PRIORITY_BOARDING` is selected (or Business/First cabin), displays a prominent `"PRIORITY BOARDING"` badge and assigns `BOARDING GROUP 1` (Group 3 for Premium Economy, Group 5 for General Economy).

---

## 7. Verification & Testing Strategy

1. **Unit Tests**:
   - `__tests__/lib/bookingPricing.test.ts`: Verify allowance calculations, bag pricing dependencies, and cabin tier overrides.
   - `__tests__/lib/validation.test.ts`: Verify `passengerAncillariesSchema` validation and error messages.
   - `__tests__/components/BookingCheckoutWizard.test.tsx`: Verify 5-step navigation, bag selection toggling, and running total price updates.
2. **PostgreSQL Database Integration Tests**:
   - `__tests__/lib/FlightBookingService.database.test.ts`: Verify multi-passenger booking with mixed ancillary selections, asserting `PassengerAncillary` rows in PostgreSQL and cascade deletion.
3. **Playwright End-to-End Tests**:
   - `e2e/ancillaries.spec.ts`: End-to-end journey from search -> seat selection -> adding checked bags & priority boarding -> payment -> confirmation and profile verification.
   - Responsiveness test across 320px, 390px, 768px, and 1280px viewports.
