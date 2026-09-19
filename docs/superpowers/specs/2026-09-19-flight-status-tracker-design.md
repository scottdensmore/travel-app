# Design Specification: Public Flight Status Tracker

**Issue**: [#351](https://github.com/scottdensmore/travel-app/issues/351) — `feat(flights): add public flight status tracker and search by flight number or route`  
**Date**: 2026-09-19  
**Status**: Approved (Brainstorming Phase)

---

## 1. Overview & Problem Statement

Travelers, friends and family members meeting arriving passengers, pickup drivers, and airport visitors need a reliable, real-time method to check flight status—including departure/arrival times, live delay estimates, terminals, and gates—without requiring an account or active booking.

Currently, the application exposes an internal `/flights` overview board that displays scheduled departures within a relative time window (`last 2 hours and next 7 days`), but lacks:
1. A dedicated public tracker route with two-mode search (Search by Flight Number + Date vs. Search by Route + Date).
2. Deep-linking / shareable URLs (e.g. `/flight-status?flight=MA101&date=2026-07-15`) for sending status links to drivers and family.
3. Gate and Terminal assignments for departures and arrivals.
4. An active `BOARDING` status phase indicator.
5. Delay notices, delay reasons, and estimated/actual timestamps.
6. A visual flight progress indicator showing elapsed journey progress.

---

## 2. Goals & Non-Goals

### Goals
- **Public Accessibility**: Zero authentication required to search and view any flight's status.
- **Two Search Modes**:
  1. *By Flight Number + Date*: e.g., Flight `MA101` on `2026-07-15` (date defaults to current day in user local time if omitted).
  2. *By Route + Date*: Origin airport (`SEA`), Destination airport (`DTW`), and Date.
- **Deep-Linkable & Shareable URLs**: State preserved in query parameters (`/flight-status?flight=MA101&date=2026-07-15` and `/flight-status?from=SEA&to=DTW&date=2026-07-15`).
- **Comprehensive Flight Status Card**:
  - High-visibility status badge (`ON_TIME`, `BOARDING`, `DEPARTED`, `ARRIVED`, `DELAYED`, `CANCELLED`).
  - Terminal and gate assignments for origin and destination.
  - Scheduled vs. Estimated/Actual departure and arrival timestamps formatted in each airport's local timezone via `lib/flightTime.ts`.
  - Visual flight path progress bar.
  - Delay reason callouts where applicable.
- **Backward Compatibility**: Seamless permanent redirect from `/flights` to `/flight-status`, and updated top navigation.
- **Zero Horizontal Overflow**: Mobile-first responsive layout with zero document-level horizontal overflow across `320px`, `390px`, `768px`, and `1280px` viewports.

### Non-Goals
- Real-time GPS flight radar positioning (progress is derived from scheduled elapsed duration).
- Admin flight editing on the public status page (operational edits remain in `/admin`).
- Baggage tracking per individual barcode (baggage allowance is already shown on boarding passes via Issue #350).

---

## 3. Architecture & Data Model

### 3.1 Prisma Schema Enhancements (`prisma/schema.prisma`)

Add operational flight tracking fields to the `Flight` model:

```prisma
model Flight {
  id                 Int          @id @default(autoincrement())
  flightNumber       String
  airline            String
  fromAirportCode    String
  toAirportCode      String
  fromAirport        Airport      @relation("FlightOrigin", fields: [fromAirportCode], references: [iataCode])
  toAirport          Airport      @relation("FlightDestination", fields: [toAirportCode], references: [iataCode])
  departureDate      DateTime     @db.Timestamptz(3)
  durationMinutes    Int?
  priceCents         Int
  status             FlightStatus @default(ON_TIME)

  // Operational & Status Tracker Attributes:
  departureTerminal  String?
  departureGate      String?
  arrivalTerminal    String?
  arrivalGate        String?
  delayReason        String?
  estimatedDeparture DateTime?    @db.Timestamptz(3)
  actualDeparture    DateTime?    @db.Timestamptz(3)
  estimatedArrival   DateTime?    @db.Timestamptz(3)
  actualArrival      DateTime?    @db.Timestamptz(3)

  flightScheduleId   Int?
  flightSchedule     FlightSchedule? @relation(fields: [flightScheduleId], references: [id], onDelete: SetNull)

  firstClassRows     Int?
  businessRows       Int?
  premiumEconomyRows Int?
  economyRows        Int?
  seatPattern        String?

  itineraryLegs      ItineraryLeg[]
  seatAssignments    SeatAssignment[]
  seatHolds          SeatHold[]

  @@unique([flightNumber, departureDate])
  @@index([departureDate])
  @@index([flightScheduleId])
  @@index([fromAirportCode])
  @@index([toAirportCode])
}
```

### 3.2 Migration Concurrency Safety
The migration script (`prisma/migrations/20260919170000_add_flight_operational_status/migration.sql`) must start with:
```sql
SET LOCAL lock_timeout = '3s';
```
to adhere to the repository's security constraint verified by `__tests__/security/migrationLockTimeout.test.ts`.

---

## 4. Domain Logic & Services

### 4.1 Deterministic Gate & Terminal Fallbacks (`lib/flightGates.ts`)

To ensure realistic, consistent gate and terminal information across all seeded, scheduled, and historical flights without requiring manual backfilling:
```ts
export interface EffectiveFlightGates {
    departureTerminal: string;
    departureGate: string;
    arrivalTerminal: string;
    arrivalGate: string;
}

export function getEffectiveFlightGates(flight: {
    flightNumber: string;
    fromAirportCode: string;
    toAirportCode: string;
    departureTerminal?: string | null;
    departureGate?: string | null;
    arrivalTerminal?: string | null;
    arrivalGate?: string | null;
}): EffectiveFlightGates;
```

**Derivation Rules**:
- If `departureTerminal` and `departureGate` are non-null on the `Flight` record, return them.
- If null, derive deterministically from the hash of `(flightNumber + fromAirportCode)`:
  - Known terminal mappings for hubs:
    - `SEA`: Terminal Main, Concourse A/B/C/D or Satellite S/N (e.g. `Gate A8`, `Gate B4`).
    - `DTW`: Terminal McNamara or Evans (e.g. `Gate A22`, `Gate D14`).
    - `JFK`: Terminal 4 or 8 (e.g. `Gate B24`).
    - `LHR`: Terminal 2, 3, or 5 (e.g. `Gate A10`).
    - `HND`: Terminal 3 (e.g. `Gate 112`).
  - Fallback generic airports: Terminal 1, Gate `[A-D][1-20]`.
- Destination gates follow the same deterministic rule using `(flightNumber + toAirportCode)`.

### 4.2 Flight Phase Expansion with `BOARDING` (`lib/flightPhase.ts`)

Update `FlightPhase` and `flightPhaseAt`:
```ts
export type FlightPhase = 'UPCOMING' | 'BOARDING' | 'DEPARTED' | 'ARRIVED' | 'DELAYED' | 'CANCELLED';

export interface FlightPhaseInput {
    departureDate: Date | string;
    durationMinutes?: number | null;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    estimatedDeparture?: Date | string | null;
    actualDeparture?: Date | string | null;
    actualArrival?: Date | string | null;
}
```

**Phase Evaluation Logic**:
1. If `flight.status === 'CANCELLED'`, return `'CANCELLED'`.
2. If `flight.actualArrival` is set, or (`flight.durationMinutes` elapsed past actual/scheduled departure and `renderedAt >= arrivalInstant`), return `'ARRIVED'`.
3. If `flight.actualDeparture` is set, or (`renderedAt >= departureInstant` and not cancelled/delayed), return `'DEPARTED'`.
4. If `flight.status === 'DELAYED'`:
   - If `flight.estimatedDeparture` is set:
     - If `renderedAt >= estimatedDepartureInstant`, return `'DEPARTED'`.
     - If `renderedAt >= estimatedDepartureInstant - 45 * 60_000`, return `'BOARDING'`.
     - Otherwise, return `'DELAYED'`.
   - If no estimated departure is set, return `'DELAYED'`.
5. For standard scheduled flights (`status === 'ON_TIME'`):
   - If `renderedAt >= departureInstant - 45 * 60_000` and `renderedAt < departureInstant`, return `'BOARDING'`.
   - If `renderedAt < departureInstant - 45 * 60_000`, return `'UPCOMING'`.

---

## 5. Validation Schemas (`lib/validation.ts`)

Add schemas for public flight status searches:
```ts
export const flightStatusSearchSchema = z.discriminatedUnion('mode', [
    z.object({
        mode: z.literal('flightNumber'),
        flightNumber: z.string().trim().min(2, 'Flight number must be at least 2 characters.').max(10),
        date: isoDateSchema.optional(),
    }),
    z.object({
        mode: z.literal('route'),
        from: airportIataCodeSchema,
        to: airportIataCodeSchema,
        date: isoDateSchema.optional(),
    }),
]).refine(
    (data) => {
        if (data.mode === 'route' && data.from.toUpperCase() === data.to.toUpperCase()) {
            return false;
        }
        return true;
    },
    { message: 'Origin and destination must be different.', path: ['to'] }
);
```

---

## 6. Server Actions & Query Services (`app/actions.ts`, `lib/flightStatusService.ts`)

### `searchFlightStatusAction(input)`
A public server action (requiring no authentication session):
1. Validates `input` against `flightStatusSearchSchema`.
2. Resolves airport time zones via `lib/airports.ts`.
3. If `mode === 'flightNumber'`:
   - Strips whitespace/hyphens (e.g. `MA 101` -> `MA101`).
   - If `date` is provided:
     - Uses `airportDayBounds(date, originTimeZone)` to bound search to the full 24-hour day in the origin's timezone.
   - If `date` is omitted:
     - Queries a 72-hour window: `[now - 24 hours, now + 48 hours]`.
   - Returns matched flight(s) with effective gates, route labels, and calculated phases.
4. If `mode === 'route'`:
   - Filters by `fromAirportCode` and `toAirportCode`.
   - Uses `airportDayBounds(date, originTimeZone)` (or current date if omitted).
   - Returns matching flights in departure order.

---

## 7. UI / UX Design (`app/flight-status/page.tsx` & `components/ui/FlightStatusTracker.tsx`)

### 7.1 Route Placement & Redirects
- **Primary Public Route**: `/flight-status`
- **Redirect**: `app/flights/page.tsx` permanently redirects to `/flight-status` (`redirect('/flight-status', RedirectType.replace)`).
- **Navigation**: `components/ui/titlebar.tsx` updates `Flight Status` link to `/flight-status`.

### 7.2 Component Architecture
- `app/flight-status/page.tsx` (Server Component):
  - Reads search params (`flight`, `from`, `to`, `date`).
  - Reads server clock snapshot via `serverRenderTime()`.
  - Performs initial server-side query so deep links render immediately with full SEO and SSR.
  - Passes initial search results and server clock to `FlightStatusTracker`.
- `components/ui/FlightStatusTracker.tsx` (Client Component):
  - Tab Switcher:
    - **Tab 1: Search by Flight Number** (Inputs: Flight Number, Date).
    - **Tab 2: Search by Route** (Inputs: Origin, Destination, Date).
  - Quick action to reset search and view general live flight board.
  - URL Query Synchronizer (`useRouter`, `usePathname`, `useSearchParams`).

### 7.3 Detailed Flight Status Card
When a flight is searched or selected:
- **Card Header**:
  - Airline name, flight number, aircraft icon.
  - Prominent status badge:
    - `ON TIME`: Green badge (`#10b981`), "On Time".
    - `BOARDING`: Amber pulsing badge (`#f59e0b`), "Now Boarding - Gate {gate}".
    - `DEPARTED`: Blue badge (`#3b82f6`), "En Route".
    - `ARRIVED`: Emerald badge (`#059669`), "Landed".
    - `DELAYED`: Red badge (`#ef4444`), "Delayed" + reason callout + revised departure time.
    - `CANCELLED`: Red badge (`#b91c1c`), "Cancelled" + notice.
- **Flight Journey Progress Bar**:
  - Visual timeline: Origin (`SEA`) ─── ✈️ ─── Destination (`DTW`).
  - Progress percentage calculated from elapsed duration when `phase === 'DEPARTED'`.
- **Departure & Arrival Panels**:
  - **Departure**: Scheduled time, Estimated/Actual time with local timezone label (`PDT`), Terminal, Gate.
  - **Arrival**: Scheduled time, Estimated/Actual time with local timezone label (`EDT`), Terminal, Gate, Baggage Carousel.
- **Trip Info**:
  - Non-stop duration (e.g. `4h 15m`).
  - Shortcut button to book flight if upcoming with available seats.

### 7.4 Responsive Layout & Accessibility
- Strict zero horizontal overflow across `320px`, `390px`, `768px`, and `1280px` viewports (`min-width: 0`, `flex-wrap: wrap`).
- Accessible semantic headings (`<h1>`, `<h2>`, `<h3>`), ARIA live regions (`role="status"`, `aria-live="polite"`), and high-contrast color tokens exceeding WCAG AA standards.

---

## 8. Testing & Verification Matrix

### 8.1 Unit & Integration Tests
- `__tests__/lib/flightGates.test.ts`:
  - Deterministic gate/terminal fallback across international and domestic airport codes.
  - Explicit database assignments override fallbacks.
- `__tests__/lib/flightPhase.test.ts`:
  - Verify `BOARDING` returned between 45m and 0m before departure.
  - Verify `DELAYED`, `CANCELLED`, `DEPARTED`, and `ARRIVED` phases.
- `__tests__/lib/validation.test.ts`:
  - Validate `flightStatusSearchSchema` for flight number, route, and date formats.
- `__tests__/components/FlightStatusTracker.test.tsx`:
  - Tab switching between flight number and route search.
  - Detailed flight card rendering, progress bar, gate/terminal display, and empty states.

### 8.2 End-to-End Tests (`e2e/flight-status.spec.ts`)
- Public anonymous visitor journey:
  - Search by flight number and assert detailed status card displays.
  - Search by route and assert matching flights display.
  - Deep-link loading `/flight-status?flight=...&date=...`.
  - Navigation from `/flights` redirects cleanly to `/flight-status`.
  - Multi-viewport responsive test asserting `clientWidth === scrollWidth` across `[320, 390, 768, 1280]`.

### 8.3 Full Verification Commands
- `npx tsc --noEmit`
- `npm run lint`
- `npm run test:unit`
- `npm run test:database`
- `CI=1 npx playwright test`
