# Baggage & Travel Ancillaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable customers to select carry-on bags, checked bags (1st and 2nd), priority boarding, and special assistance during booking checkout with cabin-aware allowances, authoritative server pricing, Stripe fingerprinting, database persistence, and boarding pass display.

**Architecture:** Add `AncillaryType` enum and `PassengerAncillary` relational model in Prisma. Extend `lib/bookingPricing.ts` and `lib/validation.ts` with cabin allowance matrices and dependency validations. Update `createPaymentAttemptAction` and `FlightBookingService.bookFlight` to bind and persist ancillaries in transactions. Expand `BookingCheckoutWizard.tsx` into a 5-step wizard with an accessible "Bags & Extras" step. Update confirmation, profile, and check-in boarding passes with baggage allowances and priority boarding badges.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma, PostgreSQL, Stripe Elements, Zod, Jest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-18-baggage-and-ancillaries-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/docs/superpowers/specs/2026-09-18-baggage-and-ancillaries-design.md)

## Global Constraints

- Ancillaries are chosen per passenger and apply to the entire booking.
- `CHECKED_BAG_2` strictly requires `CHECKED_BAG_1`.
- Cabin allowance pricing:
  - Economy: Carry-on $0, 1st Bag $35, 2nd Bag $45, Priority Boarding $15, Special Assistance $0.
  - Premium Economy: Carry-on $0, 1st Bag $0, 2nd Bag $45, Priority Boarding $15, Special Assistance $0.
  - Business: Carry-on $0, 1st Bag $0, 2nd Bag $0, Priority Boarding $0, Special Assistance $0.
  - First: Carry-on $0, 1st Bag $0, 2nd Bag $0, Priority Boarding $0, Special Assistance $0.
- Migration lock timeout: every new migration must use `SET LOCAL lock_timeout = '3s';`.
- Strict zero horizontal overflow across 320px, 390px, 768px, 1280px viewports.
- Strict TDD: tests written first, verified failing, minimal code written, tests passing, verified evidence before commit.

---

### Task 1: Schema Migration & Database Model (`PassengerAncillary`)

**Files:**
- Modify: `prisma/schema.prisma:316-350`
- Create: `prisma/migrations/20260918200000_add_passenger_ancillaries/migration.sql`
- Test: `__tests__/security/migrationLockTimeout.test.ts`

**Interfaces:**
- Produces:
  - `AncillaryType`: `enum { CARRY_ON, CHECKED_BAG_1, CHECKED_BAG_2, PRIORITY_BOARDING, SPECIAL_ASSISTANCE }`
  - `PassengerAncillary`: `model { id, passengerId, type, priceCents, createdAt }`
  - Relation on `Passenger`: `ancillaries: PassengerAncillary[]`

- [ ] **Step 1: Write the schema changes in `prisma/schema.prisma`**

Add `AncillaryType` and `PassengerAncillary` to `prisma/schema.prisma`:
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
  priceCents  Int
  createdAt   DateTime      @default(now())

  @@unique([passengerId, type])
  @@index([passengerId])
}
```
And add `ancillaries PassengerAncillary[]` to `model Passenger`.

- [ ] **Step 2: Create the migration SQL file**

Create `prisma/migrations/20260918200000_add_passenger_ancillaries/migration.sql`:
```sql
-- Migration: 20260918200000_add_passenger_ancillaries
SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "AncillaryType" AS ENUM ('CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING', 'SPECIAL_ASSISTANCE');

-- CreateTable
CREATE TABLE "PassengerAncillary" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "type" "AncillaryType" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassengerAncillary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PassengerAncillary_passengerId_type_key" ON "PassengerAncillary"("passengerId", "type");

-- CreateIndex
CREATE INDEX "PassengerAncillary_passengerId_idx" ON "PassengerAncillary"("passengerId");

-- AddForeignKey
ALTER TABLE "PassengerAncillary" ADD CONSTRAINT "PassengerAncillary_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Run migration and regenerate Prisma client**

Run:
```bash
npx prisma migrate deploy
npx prisma generate
```
Verify: migrations apply cleanly to local PostgreSQL on port 5432.

- [ ] **Step 4: Run migration lock timeout verification test**

Run: `npx jest __tests__/security/migrationLockTimeout.test.ts`
Expected: PASS (confirms migration uses `SET LOCAL lock_timeout = '3s';`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260918200000_add_passenger_ancillaries/migration.sql
git commit -m "feat(db): add AncillaryType enum and PassengerAncillary model (#350)"
```

---

### Task 2: Authoritative Pricing Rules & Validation Schemas

**Files:**
- Modify: `lib/bookingPricing.ts`
- Modify: `lib/validation.ts`
- Test: `__tests__/lib/bookingPricing.test.ts`
- Test: `__tests__/lib/validation.test.ts`

**Interfaces:**
- Consumes:
  - `AncillaryType` from `@prisma/client`
  - `CabinClass` from `@prisma/client`
- Produces:
  - `getAncillaryPriceCents(type: AncillaryType, cabin: CabinClass): number`
  - `calculatePassengerAncillaries(cabin: CabinClass, types: AncillaryType[]): { items: Array<{ type: AncillaryType; priceCents: number }>; totalCents: number }`
  - `calculateBookingAncillariesTotalCents(passengers: Array<{ cabin: CabinClass; ancillaries?: AncillaryType[] }>): number`
  - `ancillaryTypeSchema: z.ZodType<AncillaryType>`
  - `passengerAncillariesSchema: z.ZodType<AncillaryType[]>`
  - `bookingAncillariesMapSchema: z.ZodType<Record<string, AncillaryType[]>>`

- [ ] **Step 1: Write failing unit tests for pricing rules & validation**

In `__tests__/lib/bookingPricing.test.ts`:
```ts
describe('ancillary pricing and cabin allowances', () => {
    it('prices Economy checked bags and priority boarding correctly', () => {
        const result = calculatePassengerAncillaries('ECONOMY', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(result.totalCents).toBe(3500 + 4500 + 1500); // 9500 cents
        expect(result.items.find(i => i.type === 'CARRY_ON')?.priceCents).toBe(0);
        expect(result.items.find(i => i.type === 'CHECKED_BAG_1')?.priceCents).toBe(3500);
        expect(result.items.find(i => i.type === 'CHECKED_BAG_2')?.priceCents).toBe(4500);
        expect(result.items.find(i => i.type === 'PRIORITY_BOARDING')?.priceCents).toBe(1500);
    });

    it('gives Premium Economy 1 free checked bag and free carry-on', () => {
        const result = calculatePassengerAncillaries('PREMIUM_ECONOMY', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(result.totalCents).toBe(0 + 4500 + 1500); // 6000 cents
        expect(result.items.find(i => i.type === 'CHECKED_BAG_1')?.priceCents).toBe(0);
    });

    it('gives Business and First class 2 free checked bags and free priority boarding', () => {
        const bizResult = calculatePassengerAncillaries('BUSINESS', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(bizResult.totalCents).toBe(0);

        const firstResult = calculatePassengerAncillaries('FIRST', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(firstResult.totalCents).toBe(0);
    });
});
```

In `__tests__/lib/validation.test.ts`:
```ts
describe('passenger ancillaries validation', () => {
    it('accepts valid ancillary selection', () => {
        const parsed = passengerAncillariesSchema.safeParse(['CARRY_ON', 'CHECKED_BAG_1', 'PRIORITY_BOARDING']);
        expect(parsed.success).toBe(true);
    });

    it('rejects 2nd checked bag if 1st checked bag is not selected', () => {
        const parsed = passengerAncillariesSchema.safeParse(['CHECKED_BAG_2']);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.issues[0].message).toMatch(/first checked bag must be selected/i);
        }
    });

    it('rejects duplicate ancillary types for a single passenger', () => {
        const parsed = passengerAncillariesSchema.safeParse(['CHECKED_BAG_1', 'CHECKED_BAG_1']);
        expect(parsed.success).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/bookingPricing.test.ts __tests__/lib/validation.test.ts -t "ancillary"`
Expected: FAIL with undefined functions and schemas.

- [ ] **Step 3: Implement pricing functions and validation schemas**

In `lib/bookingPricing.ts`:
```ts
import { AncillaryType, CabinClass } from '@prisma/client';

export function getAncillaryPriceCents(type: AncillaryType, cabin: CabinClass): number {
    switch (type) {
        case 'CARRY_ON':
        case 'SPECIAL_ASSISTANCE':
            return 0;
        case 'CHECKED_BAG_1':
            return cabin === 'BUSINESS' || cabin === 'FIRST' || cabin === 'PREMIUM_ECONOMY' ? 0 : 3500;
        case 'CHECKED_BAG_2':
            return cabin === 'BUSINESS' || cabin === 'FIRST' ? 0 : 4500;
        case 'PRIORITY_BOARDING':
            return cabin === 'BUSINESS' || cabin === 'FIRST' ? 0 : 1500;
        default:
            return 0;
    }
}

export function calculatePassengerAncillaries(
    cabin: CabinClass,
    types: AncillaryType[]
): { items: Array<{ type: AncillaryType; priceCents: number }>; totalCents: number } {
    const items = types.map(type => ({
        type,
        priceCents: getAncillaryPriceCents(type, cabin),
    }));
    const totalCents = items.reduce((sum, item) => sum + item.priceCents, 0);
    return { items, totalCents };
}

export function calculateBookingAncillariesTotalCents(
    passengers: Array<{ cabin: CabinClass; ancillaries?: AncillaryType[] }>
): number {
    return passengers.reduce((sum, p) => {
        const { totalCents } = calculatePassengerAncillaries(p.cabin, p.ancillaries || []);
        return sum + totalCents;
    }, 0);
}
```

In `lib/validation.ts`:
```ts
export const ancillaryTypeSchema = z.enum([
    'CARRY_ON',
    'CHECKED_BAG_1',
    'CHECKED_BAG_2',
    'PRIORITY_BOARDING',
    'SPECIAL_ASSISTANCE',
]);

export const passengerAncillariesSchema = z
    .array(ancillaryTypeSchema)
    .refine(
        (types) => new Set(types).size === types.length,
        { message: 'Duplicate ancillary items are not allowed.' }
    )
    .refine(
        (types) => {
            if (types.includes('CHECKED_BAG_2') && !types.includes('CHECKED_BAG_1')) {
                return false;
            }
            return true;
        },
        { message: 'A first checked bag must be selected before adding a second checked bag.' }
    );

export const bookingAncillariesMapSchema = z.record(
    z.string(),
    passengerAncillariesSchema
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/bookingPricing.test.ts __tests__/lib/validation.test.ts -t "ancillary"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookingPricing.ts lib/validation.ts __tests__/lib/bookingPricing.test.ts __tests__/lib/validation.test.ts
git commit -m "feat(pricing): add authoritative ancillary pricing and validation schemas (#350)"
```

---

### Task 3: Server Actions & Payment Fingerprint Binding

**Files:**
- Modify: `app/actions.ts`
- Modify: `lib/FlightBookingService.ts`
- Test: `__tests__/app/actions.test.ts`
- Test: `__tests__/lib/FlightBookingService.database.test.ts`

**Interfaces:**
- Consumes:
  - `calculateBookingAncillariesTotalCents` from `lib/bookingPricing.ts`
  - `bookingAncillariesMapSchema` from `lib/validation.ts`
- Produces:
  - `createPaymentAttemptAction` accepts optional `ancillariesByPassenger: Record<string, AncillaryType[]>`
  - `FlightBookingService.bookFlight` accepts `ancillariesByPassenger` and writes `PassengerAncillary` records in transaction.

- [ ] **Step 1: Write failing database test for booking creation with ancillaries**

In `__tests__/lib/FlightBookingService.database.test.ts`:
```ts
it('persists passenger ancillaries in database during booking creation', async () => {
    const flight = await createTestFlight({ from: 'SEA', to: 'DTW' });
    const hold = await holdBookingSeats(flight.id, ['10A']);

    const booking = await FlightBookingService.bookFlight({
        userId: testUser.id,
        flightIds: [flight.id],
        idempotencyKey: randomUUID(),
        passengers: [{
            firstName: 'Sarah',
            lastName: 'Connor',
            dateOfBirth: '1985-05-12',
            passportNumber: 'P98765432',
            gender: 'F',
            cabinClass: 'ECONOMY',
            seatNumbers: ['10A'],
        }],
        ancillariesByPassenger: {
            0: ['CARRY_ON', 'CHECKED_BAG_1', 'PRIORITY_BOARDING'],
        },
    });

    const persistedPassenger = await prisma.passenger.findFirst({
        where: { bookingId: booking.id },
        include: { ancillaries: true },
    });

    expect(persistedPassenger?.ancillaries).toHaveLength(3);
    const types = persistedPassenger?.ancillaries.map(a => a.type);
    expect(types).toContain('CARRY_ON');
    expect(types).toContain('CHECKED_BAG_1');
    expect(types).toContain('PRIORITY_BOARDING');

    const bag1 = persistedPassenger?.ancillaries.find(a => a.type === 'CHECKED_BAG_1');
    expect(bag1?.priceCents).toBe(3500);

    const priority = persistedPassenger?.ancillaries.find(a => a.type === 'PRIORITY_BOARDING');
    expect(priority?.priceCents).toBe(1500);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:database -- __tests__/lib/FlightBookingService.database.test.ts -t "persists passenger ancillaries"`
Expected: FAIL.

- [ ] **Step 3: Implement ancillaries in `app/actions.ts` and `FlightBookingService.ts`**

In `lib/FlightBookingService.ts`:
- Update `BookingPassengerData` or `BookingData` to receive `ancillariesByPassenger?: Record<string | number, AncillaryType[]>`.
- Inside `bookFlight` transaction:
  Calculate ancillary prices and insert into `PassengerAncillary`:
  ```ts
  const ancillaryRecords: Array<{ passengerId: string; type: AncillaryType; priceCents: number }> = [];
  createdPassengers.forEach((p, idx) => {
      const types = (ancillariesByPassenger && ancillariesByPassenger[idx]) || [];
      const cabin = passengers[idx].cabinClass;
      types.forEach((type) => {
          ancillaryRecords.push({
              passengerId: p.id,
              type,
              priceCents: getAncillaryPriceCents(type, cabin),
          });
      });
  });
  if (ancillaryRecords.length > 0) {
      await tx.passengerAncillary.createMany({ data: ancillaryRecords });
  }
  ```

In `app/actions.ts`:
- In `createPaymentAttemptAction`: parse `ancillariesByPassenger` using `bookingAncillariesMapSchema`.
- Calculate `ancillariesTotalCents = calculateBookingAncillariesTotalCents(...)`.
- Add `ancillariesTotalCents` into `amountCents`.
- Incorporate sorted ancillaries per passenger into `requestFingerprint`.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm run test:database -- __tests__/lib/FlightBookingService.database.test.ts -t "persists passenger ancillaries"
npx jest __tests__/app/actions.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/actions.ts lib/FlightBookingService.ts __tests__/lib/FlightBookingService.database.test.ts
git commit -m "feat(booking): bind ancillaries to payment fingerprint and persist in transaction (#350)"
```

---

### Task 4: Checkout Wizard Step 3: Bags & Extras UI

**Files:**
- Modify: `components/ui/BookingCheckoutWizard.tsx`
- Test: `__tests__/components/BookingCheckoutWizard.test.tsx`

**Interfaces:**
- Consumes:
  - `AncillaryType` from `@prisma/client`
  - `getAncillaryPriceCents`, `calculatePassengerAncillaries` from `lib/bookingPricing.ts`
- Produces:
  - 5-step wizard progression (`1: Travelers`, `2: Seats`, `3: Bags & Extras`, `4: Review & Payment`, `5: Confirmation`).
  - Interactive, accessible selection cards for each passenger.

- [ ] **Step 1: Write failing unit tests for Wizard Step 3**

In `__tests__/components/BookingCheckoutWizard.test.tsx`:
```tsx
describe('BookingCheckoutWizard step 3: Bags & Extras', () => {
    it('navigates from Seats (Step 2) to Bags & Extras (Step 3) and displays options', async () => {
        renderWizard();
        // Fill Step 1 and proceed
        fillValidPassengerInfo();
        fireEvent.click(screen.getByRole('button', { name: /select seats/i }));

        // Select seat and proceed
        selectSeat('10A');
        fireEvent.click(screen.getByRole('button', { name: /continue to bags & extras/i }));

        // Now in Step 3
        expect(screen.getByText(/step 3 of 5/i)).toBeInTheDocument();
        expect(screen.getByText(/bags & travel extras/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/first checked bag/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/priority boarding/i)).toBeInTheDocument();
    });

    it('toggles checked bags and updates running total', async () => {
        renderWizard();
        goToStep3();

        const bag1Checkbox = screen.getByLabelText(/first checked bag/i);
        fireEvent.click(bag1Checkbox);

        // Subtotal shows $35
        expect(screen.getByText(/extras total: \$35/i)).toBeInTheDocument();

        // 2nd bag is now enabled
        const bag2Checkbox = screen.getByLabelText(/second checked bag/i);
        expect(bag2Checkbox).not.toBeDisabled();
        fireEvent.click(bag2Checkbox);

        // Subtotal shows $80 ($35 + $45)
        expect(screen.getByText(/extras total: \$80/i)).toBeInTheDocument();
    });

    it('navigates backward to Step 2 and forward to Step 4', async () => {
        renderWizard();
        goToStep3();

        // Back to seats
        fireEvent.click(screen.getByRole('button', { name: /back to seats/i }));
        expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();

        // Forward back to extras and then to payment
        fireEvent.click(screen.getByRole('button', { name: /continue to bags & extras/i }));
        fireEvent.click(screen.getByRole('button', { name: /continue to review & payment/i }));
        expect(screen.getByText(/step 4 of 5/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/BookingCheckoutWizard.test.tsx -t "Bags & Extras"`
Expected: FAIL with step navigation or missing buttons.

- [ ] **Step 3: Implement Step 3 in `BookingCheckoutWizard.tsx`**

1. Update `step` type: `useState<1 | 2 | 3 | 4 | 5>(1)`.
2. Add state for ancillaries:
   ```ts
   const [ancillariesByPassenger, setAncillariesByPassenger] = useState<Record<number, AncillaryType[]>>({});
   ```
3. Update progression indicator to show 5 numbered circles (`1: Travelers`, `2: Seats`, `3: Bags & Extras`, `4: Payment`, `5: Confirmed`).
4. In Step 2 footer, update primary button text to `"Continue to Bags & Extras →"`, advancing to `step = 3`.
5. Render `step === 3`:
   - Header: `"Bags & Travel Extras"`.
   - Subtitle: `"Select baggage allowance and optional priority boarding for your trip."`.
   - For each passenger, render accessible cards:
     - Carry-on: checked & disabled (included).
     - 1st Checked Bag: toggle card showing `$35` (or `"Included with your cabin"` for Premium Economy, Business, First).
     - 2nd Checked Bag: toggle card showing `$45` (or `"Included with your cabin"` for Business, First). Disabled if 1st bag is not checked.
     - Priority Boarding: toggle card showing `$15` (or `"Included with your cabin"` for Business, First).
     - Special Assistance: toggle card ($0).
   - Running ancillary total callout.
   - Buttons: `← Back to Seats` and `Continue to Review & Payment →`.
6. Pass `ancillariesByPassenger` to `createPaymentAttemptAction` and `bookFlight`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/BookingCheckoutWizard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/BookingCheckoutWizard.tsx __tests__/components/BookingCheckoutWizard.test.tsx
git commit -m "feat(ui): add Step 3 Bags & Extras to checkout wizard (#350)"
```

---

### Task 5: Confirmation Receipt, Profile Display, and Boarding Pass Integration

**Files:**
- Modify: `components/ui/BookingCheckoutWizard.tsx` (Step 5 confirmation)
- Modify: `components/ui/ProfileClient.tsx`
- Modify: `components/ui/CheckInPanel.tsx`
- Modify: `lib/travelDocumentEmail.ts`
- Test: `__tests__/components/ProfileClient.test.tsx`
- Test: `__tests__/components/CheckInPanel.test.tsx`

**Interfaces:**
- Consumes:
  - `PassengerAncillary` from Prisma queries
- Produces:
  - Itemized display of baggage & priority boarding in receipts and profile.
  - `BAGS: {count}` and `PRIORITY BOARDING` badge on check-in boarding passes.

- [ ] **Step 1: Write failing tests for confirmation & boarding pass display**

In `__tests__/components/CheckInPanel.test.tsx`:
```tsx
it('displays baggage count and priority boarding badge on boarding pass', () => {
    renderCheckInPanel({
        passenger: {
            firstName: 'Elena',
            lastName: 'Rostova',
            ancillaries: [
                { type: 'CHECKED_BAG_1', priceCents: 3500 },
                { type: 'PRIORITY_BOARDING', priceCents: 1500 },
            ],
        },
    });

    expect(screen.getByText(/priority boarding/i)).toBeInTheDocument();
    expect(screen.getByText(/bags: 1/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/CheckInPanel.test.tsx -t "baggage count and priority boarding"`
Expected: FAIL.

- [ ] **Step 3: Implement display logic**

1. In `components/ui/CheckInPanel.tsx` and `lib/travelDocumentEmail.ts`:
   - Calculate checked bag count (`ancillaries.filter(a => a.type.startsWith('CHECKED_BAG')).length`).
   - If passenger has `PRIORITY_BOARDING` (or cabin is Business/First):
     - Display `"PRIORITY BOARDING"` badge and `"GROUP 1"`.
   - Render `BAGS: {count}` on the boarding card.
2. In `BookingCheckoutWizard.tsx` (Step 5) and `ProfileClient.tsx`:
   - Under passenger seat info, render summary chip: `🧳 {bagCount} Checked Bag(s)` and `⚡ Priority Boarding` if selected.
   - Show itemized subtotal for `Bags & Extras: $XX.XX`.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx jest __tests__/components/CheckInPanel.test.tsx
npx jest __tests__/components/ProfileClient.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/CheckInPanel.tsx lib/travelDocumentEmail.ts components/ui/ProfileClient.tsx components/ui/BookingCheckoutWizard.tsx __tests__/components/CheckInPanel.test.tsx __tests__/components/ProfileClient.test.tsx
git commit -m "feat(ui): display baggage allowance and priority boarding on boarding pass and profile (#350)"
```

---

### Task 6: End-to-End User Journey Tests & Full Verification

**Files:**
- Create: `e2e/ancillaries.spec.ts`

- [ ] **Step 1: Write the Playwright E2E test**

Create `e2e/ancillaries.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';
import { completeCheckoutPayment } from './helpers/checkoutPayment';

test.describe('Baggage and Travel Ancillaries Journey', () => {
    const testEmail = `ancillary-${Date.now()}@example.com`;
    const password = 'Password123!';

    test.beforeEach(async ({ page }) => {
        await createVerifiedAccount(page, { name: 'Traveler With Bags', email: testEmail, password });
        await signInWithCredentials(page, { email: testEmail, password });
    });

    test('User books a flight with checked baggage and priority boarding', async ({ page }) => {
        await page.goto('/');

        // 1. Search flight
        await page.click('button:has-text("Find your trip")');
        await page.click('button:has-text("Select") >> nth=0');

        // 2. Step 1: Passenger info
        await page.fill('input[placeholder="John"]', 'Arthur');
        await page.fill('input[placeholder="Doe"]', 'Dent');
        await page.fill('input[type="date"]', '1982-03-11');
        await page.fill('input[placeholder="A00000000"]', 'P12345678');
        await page.click('button:has-text("Select Seats →")');

        // 3. Step 2: Select seat
        await page.locator('button[title="Select Seat 11A"]').first().click();
        await page.click('button:has-text("Continue to Bags & Extras →")');

        // 4. Step 3: Bags & Extras
        await expect(page.locator('text=Step 3 of 5')).toBeVisible();
        await page.click('label:has-text("1st Checked Bag")');
        await page.click('label:has-text("Priority Boarding")');
        await expect(page.locator('text=Extras Total: $50')).toBeVisible();
        await page.click('button:has-text("Continue to Review & Payment →")');

        // 5. Step 4: Review & Payment
        await expect(page.locator('text=Bags & Extras: $50.00')).toBeVisible();
        await completeCheckoutPayment(page);

        // 6. Step 5: Confirmation
        await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('text=1 Checked Bag')).toBeVisible();
        await expect(page.locator('text=Priority Boarding')).toBeVisible();
    });

    test('Bags & Extras step has zero horizontal overflow across breakpoints', async ({ page }) => {
        await page.goto('/');
        await page.click('button:has-text("Find your trip")');
        await page.click('button:has-text("Select") >> nth=0');

        await page.fill('input[placeholder="John"]', 'Arthur');
        await page.fill('input[placeholder="Doe"]', 'Dent');
        await page.fill('input[type="date"]', '1982-03-11');
        await page.fill('input[placeholder="A00000000"]', 'P12345678');
        await page.click('button:has-text("Select Seats →")');
        await page.locator('button[title="Select Seat 11A"]').first().click();
        await page.click('button:has-text("Continue to Bags & Extras →")');

        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect.poll(() => page.evaluate(() => ({
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
            }))).toEqual({ clientWidth: width, scrollWidth: width });
        }
    });
});
```

- [ ] **Step 2: Run Playwright test to verify it passes**

Run: `CI=1 npx playwright test e2e/ancillaries.spec.ts --reporter=list`
Expected: PASS (both tests pass).

- [ ] **Step 3: Run Full Verification Suite**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:database
CI=1 npx playwright test --reporter=list
```
Expected: All suites PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add e2e/ancillaries.spec.ts
git commit -m "test(e2e): add user journey and responsive tests for baggage and ancillaries (#350)"
```

---

### Task 7: Pull Request Creation

- [ ] **Step 1: Push branch to origin**

```bash
git push -u origin scottdensmore/feat/baggage-and-ancillaries
```

- [ ] **Step 2: Create PR on GitHub**

```bash
gh pr create --title "feat(checkout): add baggage selection and travel ancillaries to booking wizard (#350)"
```
