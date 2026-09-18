# Multi-City Itineraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable customers to search, select, and book multi-city stopover itineraries (2 to 5 legs) with dynamic leg rows, step-by-step progressive selection, running total pricing, generalized checkout parameters, and complete database persistence.

**Architecture:** Extend domain validation limits (`MAX_ITINERARY_LEGS = 5`) and introduce `searchMultiCityFlightsSchema` with sequential date rules. Add `searchMultiCityFlightsAction` to concurrently search legs with independent fault isolation. Enhance `flightBookingForm.tsx` to support a "Multi-city" trip type with dynamic leg rows and step-by-step selection. Generalize `/checkout` query parameters (`flights=id1,id2,id3...`) with backward compatibility for legacy `outbound`/`inbound`. Verify end-to-end via unit tests, PostgreSQL database tests, and Playwright user journey tests.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, TypeScript, Zod, Prisma, PostgreSQL, Jest, React Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-18-multicity-itineraries-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/docs/superpowers/specs/2026-09-18-multicity-itineraries-design.md)

## Global Constraints

- `MAX_ITINERARY_LEGS = 5`
- Minimum legs for multi-city search: 2; maximum legs: 5.
- Each leg must have distinct origin and destination (`from !== to`).
- Sequential departure date ordering: `Date(Leg N) >= Date(Leg N-1)`.
- Reusing an active page and local CDP viewport resizing across responsive breakpoints; zero horizontal overflow at 320px, 390px, 768px, 1280px.
- Backwards compatibility for `/checkout?outbound=X&inbound=Y`.
- Strict TDD: tests written first, verified failing, minimal code written, tests passing, verified evidence before commit.

---

### Task 1: Validation Limits & Multi-City Search Schema

**Files:**
- Modify: `lib/validation.ts:16-20, 355-385`
- Test: `__tests__/lib/validation.test.ts`

**Interfaces:**
- Produces:
  - `MAX_ITINERARY_LEGS: number = 5`
  - `multiCityLegSchema: z.ZodType<{ from: string; to: string; departureDate: string }>`
  - `searchMultiCityFlightsSchema: z.ZodType<{ legs: Array<{ from: string; to: string; departureDate: string }>; cabinClass?: CabinClass }>`

- [ ] **Step 1: Write the failing unit tests**

Add tests to `__tests__/lib/validation.test.ts`:
```ts
describe('multi-city itinerary validation', () => {
    it('sets MAX_ITINERARY_LEGS to 5', () => {
        expect(MAX_ITINERARY_LEGS).toBe(5);
    });

    it('accepts a valid 3-leg multi-city search with ordered dates', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2026-07-05' },
                { from: 'New York, USA', to: 'Seattle, USA', departureDate: '2026-07-10' },
            ],
            cabinClass: 'ECONOMY',
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
    });

    it('refuses multi-city search with fewer than 2 legs', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/at least 2 legs/i);
    });

    it('refuses multi-city search with more than 5 legs', () => {
        const payload = {
            legs: Array.from({ length: 6 }, (_, i) => ({
                from: `City ${i}`,
                to: `City ${i + 1}`,
                departureDate: '2026-07-01',
            })),
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/at most 5 legs/i);
    });

    it('refuses a leg where origin and destination are identical', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Seattle, USA', departureDate: '2026-07-01' },
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-05' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/origin and destination must be different/i);
    });

    it('refuses non-sequential departure dates where a later leg departs earlier than an earlier leg', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-10' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2026-07-05' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/cannot be earlier than/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/validation.test.ts -t "multi-city itinerary validation"`
Expected: FAIL with `MAX_ITINERARY_LEGS is 2` or `searchMultiCityFlightsSchema is not defined`.

- [ ] **Step 3: Implement minimal validation changes**

In `lib/validation.ts`:
Update `MAX_ITINERARY_LEGS`:
```ts
/// Multi-city itineraries support up to 5 customer-chosen stopover legs (#131).
export const MAX_ITINERARY_LEGS = 5;
```

Export `multiCityLegSchema` and `searchMultiCityFlightsSchema`:
```ts
export const multiCityLegSchema = z.object({
    from: requiredText('Origin', 128),
    to: requiredText('Destination', 128),
    departureDate: dateOnlySchema,
}).refine(leg => leg.from.trim().toLowerCase() !== leg.to.trim().toLowerCase(), {
    message: 'Origin and destination must be different.',
    path: ['to'],
});

export const searchMultiCityFlightsSchema = z.object({
    legs: z.array(multiCityLegSchema, { error: 'At least 2 legs are required for a multi-city search.' })
        .min(2, 'At least 2 legs are required for a multi-city search.')
        .max(MAX_ITINERARY_LEGS, `At most ${MAX_ITINERARY_LEGS} legs are allowed.`),
    cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']).optional(),
}).superRefine(({ legs }, context) => {
    for (let i = 1; i < legs.length; i++) {
        if (legs[i].departureDate < legs[i - 1].departureDate) {
            context.addIssue({
                code: 'custom',
                path: ['legs', i, 'departureDate'],
                message: `Flight ${i + 1} departure date cannot be earlier than Flight ${i} departure date.`,
            });
        }
    }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/validation.test.ts`
Expected: PASS (all tests in suite pass).

- [ ] **Step 5: Commit**

```bash
git add lib/validation.ts __tests__/lib/validation.test.ts
git commit -m "feat(validation): raise MAX_ITINERARY_LEGS to 5 and add multi-city search schema (#131)"
```

---

### Task 2: Server Action for Multi-City Flight Search

**Files:**
- Modify: `app/actions.ts:210-230`
- Test: `__tests__/app/actions.test.ts`

**Interfaces:**
- Consumes:
  - `searchMultiCityFlightsSchema` from `lib/validation.ts`
  - `searchOneDirection` from `app/actions.ts`
- Produces:
  - `searchMultiCityFlightsAction(input: unknown): Promise<ActionResult<MultiCitySearchResponse>>`
  - `MultiCityLegSearchResult`
  - `MultiCitySearchResponse`

- [ ] **Step 1: Write the failing unit tests**

Add tests to `__tests__/app/actions.test.ts`:
```ts
describe('searchMultiCityFlightsAction', () => {
    it('returns parallel leg results for valid multi-city criteria', async () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2026-07-05' },
            ],
            cabinClass: 'ECONOMY',
        };

        const result = await searchMultiCityFlightsAction(payload);
        expect(result).toHaveProperty('legs');
        if ('legs' in result) {
            expect(result.legs).toHaveLength(2);
            expect(result.legs[0].status).toBe('ok');
            expect(result.legs[1].status).toBe('ok');
            expect(result.legs[0].from).toBe('Seattle, USA');
            expect(result.legs[1].from).toBe('Detroit, USA');
        }
    });

    it('gracefully isolates failure on one leg while returning ok for others', async () => {
        // Leg 2 has an invalid / unresolvable route
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01' },
                { from: 'Detroit, USA', to: 'Nonexistent Airport', departureDate: '2026-07-05' },
            ],
        };

        const result = await searchMultiCityFlightsAction(payload);
        expect(result).toHaveProperty('legs');
        if ('legs' in result) {
            expect(result.legs[0].status).toBe('ok');
            expect(result.legs[1].flights).toEqual([]);
        }
    });

    it('returns validation errors for invalid payload', async () => {
        const result = await searchMultiCityFlightsAction({ legs: [] });
        expect(result).toHaveProperty('validation');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/actions.test.ts -t "searchMultiCityFlightsAction"`
Expected: FAIL with `searchMultiCityFlightsAction is not defined`.

- [ ] **Step 3: Implement `searchMultiCityFlightsAction`**

In `app/actions.ts`:
Export the return types and action function:
```ts
export type MultiCityLegSearchResult =
    | {
        status: 'ok';
        from: string;
        to: string;
        departureDate: string;
        flights: SearchResultFlight[];
        nearbyDates: string[];
      }
    | {
        status: 'unavailable';
        from: string;
        to: string;
        departureDate: string;
        flights: [];
        nearbyDates: [];
      };

export interface MultiCitySearchResponse {
    legs: MultiCityLegSearchResult[];
    cabinClass?: CabinClass;
}

export async function searchMultiCityFlightsAction(
    input: unknown
): Promise<ActionValidationFailure | MultiCitySearchResponse> {
    const parsed = parseActionInput(searchMultiCityFlightsSchema, input);
    if (!parsed.ok) return parsed;

    const { legs, cabinClass } = parsed.data;
    const now = new Date();

    const legResults = await Promise.allSettled(
        legs.map(leg => searchOneDirection(leg.from, leg.to, leg.departureDate, now, cabinClass))
    );

    const mappedLegs: MultiCityLegSearchResult[] = legResults.map((res, index) => {
        const criteria = legs[index];
        if (res.status === 'fulfilled' && res.value !== null) {
            return {
                status: 'ok',
                from: criteria.from,
                to: criteria.to,
                departureDate: criteria.departureDate,
                flights: res.value.flights,
                nearbyDates: res.value.nearbyDates,
            };
        }
        return {
            status: 'unavailable',
            from: criteria.from,
            to: criteria.to,
            departureDate: criteria.departureDate,
            flights: [],
            nearbyDates: [],
        };
    });

    return {
        legs: mappedLegs,
        cabinClass,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/actions.test.ts -t "searchMultiCityFlightsAction"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/actions.ts __tests__/app/actions.test.ts
git commit -m "feat(search): add searchMultiCityFlightsAction with parallel execution (#131)"
```

---

### Task 3: Multi-Leg Checkout URL Generalization

**Files:**
- Modify: `app/checkout/page.tsx:23-76`
- Test: `__tests__/app/checkoutPage.test.tsx`

**Interfaces:**
- Consumes:
  - `searchParams: { flights?: string | string[]; outbound?: string | string[]; inbound?: string | string[]; cabin?: string | string[] }`
  - `MAX_ITINERARY_LEGS` from `lib/validation.ts`
- Produces:
  - Route loader accepting `flights=1,2,3` or `flights=1&flights=2` for multi-leg checkouts while preserving legacy `outbound`/`inbound`.

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/app/checkoutPage.test.tsx`:
```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import CheckoutPage from '@/app/checkout/page';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('next/navigation', () => ({
    notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
    redirect: jest.fn(() => { throw new Error('NEXT_REDIRECT'); }),
}));
jest.mock('@/lib/prisma', () => ({
    prisma: {
        flight: { findMany: jest.fn() },
        user: { findUniqueOrThrow: jest.fn() },
    },
}));
jest.mock('@/app/actions', () => ({
    getOccupiedSeatsAction: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/components/ui/BookingCheckoutWizard', () => ({
    __esModule: true,
    default: ({ flights }: { flights: Array<{ flightNumber: string }> }) => (
        <div data-testid="wizard">
            {flights.map(f => <span key={f.flightNumber}>{f.flightNumber}</span>)}
        </div>
    ),
}));

describe('CheckoutPage multi-leg flight parameter parsing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'user-123' },
        });
        (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
            timeZone: 'America/New_York',
        });
    });

    it('loads 3 flights from comma-separated flights query parameter', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            { id: 10, flightNumber: 'FL10', airline: 'Mona', fromAirport: { label: 'SEA' }, toAirport: { label: 'DTW' }, departureDate: new Date(), durationMinutes: 200, priceCents: 10000, firstClassRows: 2, businessRows: 2, premiumEconomyRows: 2, economyRows: 10, seatPattern: '3-3' },
            { id: 20, flightNumber: 'FL20', airline: 'Mona', fromAirport: { label: 'DTW' }, toAirport: { label: 'JFK' }, departureDate: new Date(), durationMinutes: 120, priceCents: 8000, firstClassRows: 2, businessRows: 2, premiumEconomyRows: 2, economyRows: 10, seatPattern: '3-3' },
            { id: 30, flightNumber: 'FL30', airline: 'Mona', fromAirport: { label: 'JFK' }, toAirport: { label: 'SEA' }, departureDate: new Date(), durationMinutes: 300, priceCents: 15000, firstClassRows: 2, businessRows: 2, premiumEconomyRows: 2, economyRows: 10, seatPattern: '3-3' },
        ]);

        const searchParams = Promise.resolve({ flights: '10,20,30' });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
        expect(screen.getByText('FL20')).toBeInTheDocument();
        expect(screen.getByText('FL30')).toBeInTheDocument();
    });

    it('preserves backward compatibility with outbound and inbound query parameters', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            { id: 10, flightNumber: 'FL10', airline: 'Mona', fromAirport: { label: 'SEA' }, toAirport: { label: 'DTW' }, departureDate: new Date(), durationMinutes: 200, priceCents: 10000, firstClassRows: 2, businessRows: 2, premiumEconomyRows: 2, economyRows: 10, seatPattern: '3-3' },
            { id: 20, flightNumber: 'FL20', airline: 'Mona', fromAirport: { label: 'DTW' }, toAirport: { label: 'SEA' }, departureDate: new Date(), durationMinutes: 200, priceCents: 10000, firstClassRows: 2, businessRows: 2, premiumEconomyRows: 2, economyRows: 10, seatPattern: '3-3' },
        ]);

        const searchParams = Promise.resolve({ outbound: '10', inbound: '20' });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
        expect(screen.getByText('FL20')).toBeInTheDocument();
    });

    it('returns notFound when flights contains duplicates', async () => {
        const searchParams = Promise.resolve({ flights: '10,20,10' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('returns notFound when flights exceeds MAX_ITINERARY_LEGS (5)', async () => {
        const searchParams = Promise.resolve({ flights: '1,2,3,4,5,6' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/checkoutPage.test.tsx`
Expected: FAIL with `flights parameter not recognized` or `NEXT_NOT_FOUND`.

- [ ] **Step 3: Implement `flights` parameter generalization in `app/checkout/page.tsx`**

In `app/checkout/page.tsx`:
```tsx
interface PageProps {
    searchParams: Promise<{
        flights?: string | string[];
        outbound?: string | string[];
        inbound?: string | string[];
        cabin?: string | string[];
    }>;
}

function parseFlightIds(param: string | string[] | undefined): number[] | null {
    if (!param) return null;
    const rawTokens = Array.isArray(param)
        ? param.flatMap(p => p.split(','))
        : param.split(',');

    const ids: number[] = [];
    for (const token of rawTokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;
        const id = Number(trimmed);
        if (!Number.isInteger(id) || id <= 0) return null;
        ids.push(id);
    }
    return ids.length > 0 ? ids : null;
}
```

In `CheckoutPage`:
```tsx
    const { flights: flightsParam, outbound, inbound, cabin } = await searchParams;
    const searchedCabin = typeof cabin === 'string' && CABINS.includes(cabin as Cabin)
        ? (cabin as Cabin)
        : undefined;

    let flightIds: number[];

    const parsedMulti = parseFlightIds(flightsParam);
    if (parsedMulti !== null) {
        if (parsedMulti.length > MAX_ITINERARY_LEGS) notFound();
        if (new Set(parsedMulti).size !== parsedMulti.length) notFound();
        flightIds = parsedMulti;
    } else {
        const outboundId = flightIdParam(outbound);
        if (!outboundId) notFound();

        const inboundId = inbound === undefined ? null : flightIdParam(inbound);
        if (inbound !== undefined && inboundId === null) notFound();
        if (inboundId !== null && inboundId === outboundId) notFound();

        flightIds = inboundId === null ? [outboundId] : [outboundId, inboundId];
        if (flightIds.length > MAX_ITINERARY_LEGS) notFound();
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/checkoutPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/checkout/page.tsx __tests__/app/checkoutPage.test.tsx
git commit -m "feat(checkout): generalize route parameters to multi-leg flights list (#131)"
```

---

### Task 4: Multi-City Search Form UI with Dynamic Leg Rows

**Files:**
- Modify: `components/ui/flightBookingForm.tsx`
- Test: `__tests__/components/flightBookingForm.test.tsx`

**Interfaces:**
- Consumes:
  - `searchMultiCityFlightsAction` from `app/actions.ts`
  - Airport routes list
- Produces:
  - "Multi-city" radio control in search form.
  - Dynamic leg row list with "Add flight" and "Remove" buttons.
  - Automatic defaulting of Leg *N* origin to Leg *N-1* destination.
  - Form validation for sequential departure dates.

- [ ] **Step 1: Write the failing unit tests**

Add tests to `__tests__/components/flightBookingForm.test.tsx`:
```tsx
describe('Multi-city trip type search form', () => {
    it('renders Multi-city radio option and switches to multi-city mode', () => {
        render(<FlightBookingForm routes={routes} />);
        const multiCityRadio = screen.getByLabelText(/multi-city/i);
        expect(multiCityRadio).toBeInTheDocument();

        fireEvent.click(multiCityRadio);
        expect(screen.getByText(/flight 1/i)).toBeInTheDocument();
        expect(screen.getByText(/flight 2/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add flight/i })).toBeInTheDocument();
    });

    it('allows adding a 3rd leg, defaulting origin to previous destination', () => {
        render(<FlightBookingForm routes={routes} />);
        fireEvent.click(screen.getByLabelText(/multi-city/i));

        const addBtn = screen.getByRole('button', { name: /add flight/i });
        fireEvent.click(addBtn);

        expect(screen.getByText(/flight 3/i)).toBeInTheDocument();
        // Can add up to 5 legs
        fireEvent.click(addBtn); // 4
        fireEvent.click(addBtn); // 5
        expect(screen.queryByRole('button', { name: /add flight/i })).toBeNull();
    });

    it('allows removing legs down to minimum of 2', () => {
        render(<FlightBookingForm routes={routes} />);
        fireEvent.click(screen.getByLabelText(/multi-city/i));

        const addBtn = screen.getByRole('button', { name: /add flight/i });
        fireEvent.click(addBtn); // 3 legs
        expect(screen.getByText(/flight 3/i)).toBeInTheDocument();

        const removeBtn = screen.getByLabelText(/remove flight 3/i);
        fireEvent.click(removeBtn);

        expect(screen.queryByText(/flight 3/i)).toBeNull();
        // Remove button is hidden when only 2 legs remain
        expect(screen.queryByLabelText(/remove flight/i)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/flightBookingForm.test.tsx -t "Multi-city trip type search form"`
Expected: FAIL with `Unable to find label "multi-city"`.

- [ ] **Step 3: Implement multi-city search form controls in `components/ui/flightBookingForm.tsx`**

1. Add trip type state: `'round-trip' | 'one-way' | 'multi-city'`.
2. Add multi-city legs state:
   ```ts
   interface MultiCityLegFormState {
       id: string;
       from: string;
       to: string;
       departureDate: string;
   }
   ```
3. In `renderSearchForm()`, add third radio button:
   ```tsx
   <li className={tripType === 'multi-city' ? 'selected' : ''}>
       <label>
           <input
               type="radio"
               name="tripType"
               value="multi-city"
               checked={tripType === 'multi-city'}
               onChange={() => setTripType('multi-city')}
           />
           Multi-city
       </label>
   </li>
   ```
4. When `tripType === 'multi-city'`, render dynamic leg rows:
   - Each row has `Flight {index + 1}` header, `From` select, `To` select, `Date` input.
   - If `index >= 2`, render accessible remove button: `<button type="button" aria-label={`Remove Flight ${index + 1}`} onClick={() => removeLeg(index)}>✕ Remove</button>`.
   - If `legs.length < 5`, render `<button type="button" onClick={addLeg}>+ Add flight</button>`.
   - When adding a leg, pre-fill `from` with previous leg's `to`, and `departureDate` with previous leg's `departureDate`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/flightBookingForm.test.tsx -t "Multi-city trip type search form"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/flightBookingForm.tsx __tests__/components/flightBookingForm.test.tsx
git commit -m "feat(ui): add multi-city radio and dynamic leg rows to search form (#131)"
```

---

### Task 5: Step-by-Step Leg Selection & Itinerary Progress Header

**Files:**
- Modify: `components/ui/flightBookingForm.tsx`
- Test: `__tests__/components/flightBookingForm.test.tsx`

**Interfaces:**
- Consumes:
  - `MultiCitySearchResponse` from `searchMultiCityFlightsAction`
- Produces:
  - Interactive multi-leg progress header with running total price and edit chips.
  - Progressive step-by-step flight selection across legs.
  - Final "Review & Book Itinerary" button leading to `/checkout?flights=...`.

- [ ] **Step 1: Write the failing unit tests**

Add tests to `__tests__/components/flightBookingForm.test.tsx`:
```tsx
describe('Multi-city step-by-step selection flow', () => {
    it('shows itinerary progress header and steps through leg selections', async () => {
        const multiSearchResponse = {
            legs: [
                {
                    status: 'ok',
                    from: 'Seattle, USA',
                    to: 'Detroit, USA',
                    departureDate: '2026-07-01',
                    flights: [{ id: 101, flightNumber: 'MA101', airline: 'Mona Airways', from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01T08:00:00Z', priceCents: 30000, cabinAvailable: true }],
                    nearbyDates: [],
                },
                {
                    status: 'ok',
                    from: 'Detroit, USA',
                    to: 'New York, USA',
                    departureDate: '2026-07-05',
                    flights: [{ id: 102, flightNumber: 'MA102', airline: 'Mona Airways', from: 'Detroit, USA', to: 'New York, USA', departureDate: '2026-07-05T12:00:00Z', priceCents: 20000, cabinAvailable: true }],
                    nearbyDates: [],
                },
            ],
        };

        // Render with multi-city search results
        render(<FlightBookingForm routes={routes} initialMultiCityResults={multiSearchResponse} />);

        // Progress bar should show Step 1 of 2
        expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument();
        expect(screen.getByText('MA101')).toBeInTheDocument();

        // Select Leg 1 flight
        fireEvent.click(screen.getByRole('button', { name: /select flight ma101/i }));

        // Advances to Step 2 of 2
        expect(screen.getByText(/step 2 of 2/i)).toBeInTheDocument();
        expect(screen.getByText('MA102')).toBeInTheDocument();
        expect(screen.getByText(/\$300/)).toBeInTheDocument(); // Running total

        // Select Leg 2 flight
        fireEvent.click(screen.getByRole('button', { name: /select flight ma102/i }));

        // Both selected: shows total $500 and Review & Book Itinerary button
        expect(screen.getByText(/\$500/)).toBeInTheDocument();
        const bookBtn = screen.getByRole('link', { name: /review & book itinerary/i });
        expect(bookBtn).toHaveAttribute('href', expect.stringContaining('/checkout?flights=101,102'));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/flightBookingForm.test.tsx -t "Multi-city step-by-step selection flow"`
Expected: FAIL with missing progress header or selection handler.

- [ ] **Step 3: Implement step-by-step selection and itinerary progress header**

In `components/ui/flightBookingForm.tsx`:
1. Add state:
   - `multiCityResults: MultiCitySearchResponse | null`
   - `activeLegStepIndex: number` (0..N-1)
   - `selectedMultiCityFlights: Array<SearchResultFlight | null>`
2. Calculate running total price:
   ```ts
   const multiCityRunningTotalCents = selectedMultiCityFlights.reduce(
       (sum, flight) => sum + (flight?.priceCents ?? 0),
       0
   );
   ```
3. Render `ItineraryProgressHeader`:
   - Summary route chain with chips for each leg: `Flight 1: SEA → DTW [Selected: MA101 | $300]`, `Flight 2: DTW → NYC [...]`.
   - Clicking a chip sets `activeLegStepIndex(i)` allowing the user to change any prior leg.
   - Live text: `aria-live="polite"` announcing `Step ${activeLegStepIndex + 1} of ${totalLegs}`.
4. Active leg cards:
   - Renders flight list for `multiCityResults.legs[activeLegStepIndex]`.
   - On selecting a flight, updates `selectedMultiCityFlights[activeLegStepIndex] = flight` and sets `activeLegStepIndex` to next unselected index.
5. Review & Book link:
   - When all legs have non-null flights, render checkout link:
     ```tsx
     <Link
         href={`/checkout?flights=${selectedMultiCityFlights.map(f => f!.id).join(',')}${selectedCabin ? `&cabin=${selectedCabin}` : ''}`}
         className="btn btn-primary"
     >
         Review & Book Itinerary →
     </Link>
     ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/flightBookingForm.test.tsx`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add components/ui/flightBookingForm.tsx __tests__/components/flightBookingForm.test.tsx
git commit -m "feat(ui): add progressive leg selection and running total for multi-city (#131)"
```

---

### Task 6: Database Integration & End-to-End User Journey Tests

**Files:**
- Modify: `__tests__/lib/FlightBookingService.database.test.ts`
- Create: `e2e/multicity.spec.ts`

**Interfaces:**
- Consumes:
  - Database schema (`Booking`, `ItineraryLeg`, `Passenger`)
  - Full application running at `/`
- Produces:
  - Multi-leg booking verification against PostgreSQL.
  - End-to-end Playwright user journey test covering search, leg selection, checkout, seat map, payment, and profile display.

- [ ] **Step 1: Write the failing database integration test**

In `__tests__/lib/FlightBookingService.database.test.ts`:
```ts
it('creates a 3-leg multi-city booking with ascending sequence numbers and distinct seat assignments', async () => {
    const flight1 = await createTestFlight({ from: 'SEA', to: 'DTW' });
    const flight2 = await createTestFlight({ from: 'DTW', to: 'JFK' });
    const flight3 = await createTestFlight({ from: 'JFK', to: 'SEA' });

    const booking = await FlightBookingService.bookFlight({
        userId: testUser.id,
        flightIds: [flight1.id, flight2.id, flight3.id],
        idempotencyKey: randomUUID(),
        passengers: [{
            firstName: 'Alice',
            lastName: 'Walker',
            dateOfBirth: '1992-04-10',
            passportNumber: 'P12345678',
            gender: 'F',
            cabinClass: 'ECONOMY',
            seatNumbers: ['10A', '12B', '14C'],
        }],
    });

    expect(booking.legs).toHaveLength(3);
    expect(booking.legs.map(l => l.sequence)).toEqual([1, 2, 3]);
    expect(booking.legs[0].flightId).toBe(flight1.id);
    expect(booking.legs[1].flightId).toBe(flight2.id);
    expect(booking.legs[2].flightId).toBe(flight3.id);
});
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npm run test:database -- __tests__/lib/FlightBookingService.database.test.ts`
Expected: PASS (or fixes if any sequence or limit assertions need alignment).

- [ ] **Step 3: Write the End-to-End Playwright test**

Create `e2e/multicity.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { createVerifiedAccount, signInWithCredentials } from './helpers/auth';
import { completeCheckoutPayment } from './helpers/checkoutPayment';

test.describe('Multi-City Itinerary User Journey', () => {
    const testEmail = `multicity-${Date.now()}@example.com`;
    const password = 'Password123!';

    test.beforeEach(async ({ page }) => {
        await createVerifiedAccount(page, { name: 'MultiCity Traveler', email: testEmail, password });
        await signInWithCredentials(page, { email: testEmail, password });
    });

    test('User can search, sequentially select 3 legs, choose seats, and book a multi-city itinerary', async ({ page }) => {
        await page.goto('/');

        // 1. Switch to Multi-city
        await page.click('label:has-text("Multi-city")');

        // 2. Add a 3rd flight leg
        await page.click('button:has-text("+ Add flight")');
        await expect(page.locator('text=Flight 3')).toBeVisible();

        // 3. Configure 3 legs: SEA -> DTW, DTW -> JFK, JFK -> SEA
        await page.selectOption('select[data-testid="leg-0-from"]', 'Seattle, USA');
        await page.selectOption('select[data-testid="leg-0-to"]', 'Detroit, USA');
        await page.selectOption('select[data-testid="leg-1-to"]', 'New York, USA');
        await page.selectOption('select[data-testid="leg-2-to"]', 'Seattle, USA');

        // 4. Submit search
        await page.click('button:has-text("Find your trip")');

        // 5. Select Flight 1
        await expect(page.locator('text=Step 1 of 3')).toBeVisible();
        await page.click('[data-testid="select-flight-btn"] >> nth=0');

        // 6. Select Flight 2
        await expect(page.locator('text=Step 2 of 3')).toBeVisible();
        await page.click('[data-testid="select-flight-btn"] >> nth=0');

        // 7. Select Flight 3
        await expect(page.locator('text=Step 3 of 3')).toBeVisible();
        await page.click('[data-testid="select-flight-btn"] >> nth=0');

        // 8. Proceed to checkout
        await page.click('a:has-text("Review & Book Itinerary")');
        await expect(page).toHaveURL(/\/checkout\?flights=/);

        // 9. Enter passenger details
        await page.fill('input[placeholder="John"]', 'Alice');
        await page.fill('input[placeholder="Doe"]', 'Smith');
        await page.fill('input[type="date"]', '1992-05-15');
        await page.fill('input[placeholder="A00000000"]', 'US9876543');
        await page.click('button:has-text("Select Seats →")');

        // 10. Select seats for all 3 legs in wizard
        await expect(page.locator('button[title="Select Seat 11A"]').first()).toBeVisible();
        await page.locator('button[title="Select Seat 11A"]').first().click();

        // Leg 2 tab
        await page.click('button:has-text("Flight 2")');
        await page.locator('button[title="Select Seat 11B"]').first().click();

        // Leg 3 tab
        await page.click('button:has-text("Flight 3")');
        await page.locator('button[title="Select Seat 11C"]').first().click();

        await page.click('button:has-text("Review Booking →")');
        await completeCheckoutPayment(page);

        // 11. Verify Confirmation & Profile
        await expect(page.locator('h2:has-text("Booking Confirmed!")')).toBeVisible({ timeout: 15_000 });
        await page.goto('/profile');
        await expect(page.locator('[data-testid^="booking-row-"]')).toBeVisible();
    });

    test('Multi-city controls remain responsive at 320px, 390px, and 1280px widths', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto('/');
        await page.click('label:has-text("Multi-city")');

        const formBox = await page.locator('#flight-search-form').boundingBox();
        expect(formBox).not.toBeNull();
        expect(formBox!.x).toBeGreaterThanOrEqual(0);
        expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(320);

        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            const box = await page.locator('#flight-search-form').boundingBox();
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
    });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=1 npx playwright test e2e/multicity.spec.ts --reporter=list`
Expected: PASS (both tests pass).

- [ ] **Step 5: Commit**

```bash
git add __tests__/lib/FlightBookingService.database.test.ts e2e/multicity.spec.ts
git commit -m "test(e2e): add database integration and user journey tests for multi-city itineraries (#131)"
```

---

### Task 7: Full Verification & PR Creation

**Files:**
- All modified & created files

- [ ] **Step 1: Execute Full Verification Suite**
  - Run `npx tsc --noEmit` -> Expect 0 errors
  - Run `npm run lint` -> Expect 0 errors, 0 warnings
  - Run `npm run test:unit` -> Expect all suites pass
  - Run `npm run test:database` -> Expect all 45+ suites pass
  - Run `CI=1 npx playwright test --reporter=list` -> Expect 57/57 pass

- [ ] **Step 2: Commit & Push Branch**
  - Push branch to origin

- [ ] **Step 3: Create Pull Request**
  - Open PR via `gh pr create` titled `feat(itinerary): implement multi-city flight search and booking (#131)`
