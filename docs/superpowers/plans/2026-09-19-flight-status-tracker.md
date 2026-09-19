# Public Flight Status Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated, public, accessible flight status tracker at `/flight-status` supporting search by flight number or route, deep-linkable URLs, detailed flight status cards with gate/terminal assignments, live progress bars, delay reasons, and the derived `BOARDING` phase.

**Architecture:** Extend the Prisma `Flight` model with operational tracking columns (terminals, gates, delay reasons, and estimated/actual timestamps) with deterministic fallback generation. Expose public server actions validating input via Zod schemas, localizing dates through origin airport timezones, and rendering via responsive components with zero horizontal overflow across all viewports.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma ORM, PostgreSQL, Tailwind CSS, Zod, Jest, Playwright E2E.

**Spec:** [`docs/superpowers/specs/2026-09-19-flight-status-tracker-design.md`](file:///home/scottdensmore/Developer/scottdensmore/travel-app/docs/superpowers/specs/2026-09-19-flight-status-tracker-design.md)

## Global Constraints

- Migration scripts in `prisma/migrations` must begin with `SET LOCAL lock_timeout = '3s';`.
- All monetary pricing must use integer cents minor units (e.g. `priceCents`).
- All flight departure and arrival times must be localized using airport IANA timezones through `lib/flightTime.ts` (never browser `toLocaleDateString`).
- Public route `/flight-status` must require zero authentication; `/flights` must permanently redirect to `/flight-status`.
- Mobile responsiveness: zero document-level horizontal overflow (`clientWidth === scrollWidth`) across `320px`, `390px`, `768px`, and `1280px` viewports.
- Follow strict TDD: write failing test (RED), implement minimal code (GREEN), verify, commit.
- Prefix all Playwright commands with `CI=1` to avoid hanging interactive terminal servers.

---

### Task 1: Database Model & Operational Status Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260919170000_add_flight_operational_status/migration.sql`
- Test: `__tests__/security/migrationLockTimeout.test.ts`
- Test: `__tests__/lib/flightSchema.database.test.ts`

**Interfaces:**
- Consumes: Existing `Flight` model in `prisma/schema.prisma`.
- Produces:
  - `Flight.departureTerminal: String?`
  - `Flight.departureGate: String?`
  - `Flight.arrivalTerminal: String?`
  - `Flight.arrivalGate: String?`
  - `Flight.delayReason: String?`
  - `Flight.estimatedDeparture: DateTime?`
  - `Flight.actualDeparture: DateTime?`
  - `Flight.estimatedArrival: DateTime?`
  - `Flight.actualArrival: DateTime?`

- [ ] **Step 1: Write failing database test for flight operational fields**

Create `__tests__/lib/flightSchema.database.test.ts`:
```ts
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';

describe('Flight operational fields', () => {
    it('persists and retrieves operational gate, terminal, and delay attributes', async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        const flight = await prisma.flight.create({
            data: {
                flightNumber: `TEST-OP-${Date.now()}`,
                airline: 'Mona Airways',
                ...route,
                departureDate: new Date('2026-08-01T14:00:00.000Z'),
                durationMinutes: 240,
                priceCents: 25000,
                status: 'DELAYED',
                departureTerminal: '1',
                departureGate: 'A8',
                arrivalTerminal: 'Evans',
                arrivalGate: 'D14',
                delayReason: 'Air Traffic Control hold at origin',
                estimatedDeparture: new Date('2026-08-01T14:45:00.000Z'),
            },
        });

        const fetched = await prisma.flight.findUnique({
            where: { id: flight.id },
        });

        expect(fetched?.departureGate).toBe('A8');
        expect(fetched?.departureTerminal).toBe('1');
        expect(fetched?.arrivalGate).toBe('D14');
        expect(fetched?.arrivalTerminal).toBe('Evans');
        expect(fetched?.delayReason).toBe('Air Traffic Control hold at origin');
        expect(fetched?.estimatedDeparture?.toISOString()).toBe('2026-08-01T14:45:00.000Z');

        await prisma.flight.delete({ where: { id: flight.id } });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:database -- __tests__/lib/flightSchema.database.test.ts`  
Expected: FAIL (fields do not exist on Prisma client / database).

- [ ] **Step 3: Update `prisma/schema.prisma` and create migration**

In `prisma/schema.prisma`, add to `model Flight`:
```prisma
  departureTerminal  String?
  departureGate      String?
  arrivalTerminal    String?
  arrivalGate        String?
  delayReason        String?
  estimatedDeparture DateTime?    @db.Timestamptz(3)
  actualDeparture    DateTime?    @db.Timestamptz(3)
  estimatedArrival   DateTime?    @db.Timestamptz(3)
  actualArrival      DateTime?    @db.Timestamptz(3)
```

Create migration directory `prisma/migrations/20260919170000_add_flight_operational_status/migration.sql`:
```sql
SET LOCAL lock_timeout = '3s';

-- AlterTable
ALTER TABLE "Flight" ADD COLUMN "departureTerminal" TEXT,
ADD COLUMN "departureGate" TEXT,
ADD COLUMN "arrivalTerminal" TEXT,
ADD COLUMN "arrivalGate" TEXT,
ADD COLUMN "delayReason" TEXT,
ADD COLUMN "estimatedDeparture" TIMESTAMPTZ(3),
ADD COLUMN "actualDeparture" TIMESTAMPTZ(3),
ADD COLUMN "estimatedArrival" TIMESTAMPTZ(3),
ADD COLUMN "actualArrival" TIMESTAMPTZ(3);
```

Apply migration and regenerate client:
```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx jest __tests__/security/migrationLockTimeout.test.ts
npm run test:database -- __tests__/lib/flightSchema.database.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260919170000_add_flight_operational_status/migration.sql __tests__/lib/flightSchema.database.test.ts
git commit -m "feat(db): add operational gate, terminal, and delay fields to Flight (#351)"
```

---

### Task 2: Domain Logic: Gate Fallbacks & `BOARDING` Phase Expansion

**Files:**
- Create: `lib/flightGates.ts`
- Modify: `lib/flightPhase.ts`
- Test: `__tests__/lib/flightGates.test.ts`
- Test: `__tests__/lib/flightPhase.test.ts`

**Interfaces:**
- Consumes: `Airport` and `Flight` types.
- Produces:
  - `getEffectiveFlightGates(flight): EffectiveFlightGates`
  - `flightPhaseAt(flight, renderedAt): FlightPhase` (includes `'BOARDING'`)

- [ ] **Step 1: Write failing unit tests for gate fallbacks and BOARDING phase**

Create `__tests__/lib/flightGates.test.ts`:
```ts
import { getEffectiveFlightGates } from '@/lib/flightGates';

describe('getEffectiveFlightGates', () => {
    it('returns explicit gate and terminal assignments when provided', () => {
        const result = getEffectiveFlightGates({
            flightNumber: 'MA101',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
            departureTerminal: 'Main',
            departureGate: 'B12',
            arrivalTerminal: 'Evans',
            arrivalGate: 'D5',
        });

        expect(result).toEqual({
            departureTerminal: 'Main',
            departureGate: 'B12',
            arrivalTerminal: 'Evans',
            arrivalGate: 'D5',
        });
    });

    it('deterministically derives realistic fallback terminals and gates when null', () => {
        const first = getEffectiveFlightGates({
            flightNumber: 'MA202',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });

        const second = getEffectiveFlightGates({
            flightNumber: 'MA202',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });

        expect(first).toEqual(second);
        expect(first.departureTerminal).toBeDefined();
        expect(first.departureGate).toBeDefined();
        expect(first.arrivalTerminal).toBeDefined();
        expect(first.arrivalGate).toBeDefined();
    });
});
```

In `__tests__/lib/flightPhase.test.ts`, add test cases for `BOARDING`:
```ts
it('derives BOARDING phase when within 45 minutes of scheduled departure', () => {
    const now = Date.now();
    const flight = {
        departureDate: new Date(now + 20 * 60_000), // 20 minutes from now
        durationMinutes: 120,
        status: 'ON_TIME' as const,
    };
    expect(flightPhaseAt(flight, now)).toBe('BOARDING');
});

it('derives BOARDING phase for delayed flight with estimated departure in 20 minutes', () => {
    const now = Date.now();
    const flight = {
        departureDate: new Date(now - 10 * 60_000),
        estimatedDeparture: new Date(now + 20 * 60_000),
        durationMinutes: 120,
        status: 'DELAYED' as const,
    };
    expect(flightPhaseAt(flight, now)).toBe('BOARDING');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/flightGates.test.ts __tests__/lib/flightPhase.test.ts`  
Expected: FAIL (missing module `flightGates`, `flightPhaseAt` returns `UPCOMING` instead of `BOARDING`).

- [ ] **Step 3: Implement `lib/flightGates.ts` and update `lib/flightPhase.ts`**

Create `lib/flightGates.ts`:
```ts
export interface EffectiveFlightGates {
    departureTerminal: string;
    departureGate: string;
    arrivalTerminal: string;
    arrivalGate: string;
}

interface FlightGateInput {
    flightNumber: string;
    fromAirportCode: string;
    toAirportCode: string;
    departureTerminal?: string | null;
    departureGate?: string | null;
    arrivalTerminal?: string | null;
    arrivalGate?: string | null;
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

const AIRPORT_TERMINAL_CONFIG: Record<string, { terminals: string[]; concourses: string[] }> = {
    SEA: { terminals: ['Main'], concourses: ['A', 'B', 'C', 'D', 'S', 'N'] },
    DTW: { terminals: ['McNamara', 'Evans'], concourses: ['A', 'B', 'C', 'D'] },
    JFK: { terminals: ['Terminal 4', 'Terminal 8', 'Terminal 1'], concourses: ['A', 'B', 'C'] },
    LHR: { terminals: ['Terminal 2', 'Terminal 3', 'Terminal 5'], concourses: ['A', 'B', 'C'] },
    HND: { terminals: ['Terminal 3', 'Terminal 2'], concourses: ['A', 'B'] },
    ORD: { terminals: ['Terminal 1', 'Terminal 2', 'Terminal 3'], concourses: ['B', 'C', 'E', 'F'] },
    SFO: { terminals: ['Terminal 2', 'Terminal 3', 'International'], concourses: ['D', 'E', 'F', 'G'] },
    LAX: { terminals: ['Terminal 4', 'Terminal 5', 'Tom Bradley'], concourses: ['A', 'B'] },
};

function fallbackGate(flightNumber: string, airportCode: string): { terminal: string; gate: string } {
    const config = AIRPORT_TERMINAL_CONFIG[airportCode.toUpperCase()] || {
        terminals: ['Terminal 1', 'Terminal 2'],
        concourses: ['A', 'B', 'C'],
    };

    const hash = hashString(`${flightNumber}-${airportCode}`);
    const terminal = config.terminals[hash % config.terminals.length];
    const concourse = config.concourses[(hash >> 2) % config.concourses.length];
    const gateNumber = ((hash >> 4) % 24) + 1;

    return {
        terminal,
        gate: `${concourse}${gateNumber}`,
    };
}

export function getEffectiveFlightGates(flight: FlightGateInput): EffectiveFlightGates {
    const depFallback = fallbackGate(flight.flightNumber, flight.fromAirportCode);
    const arrFallback = fallbackGate(flight.flightNumber, flight.toAirportCode);

    return {
        departureTerminal: flight.departureTerminal?.trim() || depFallback.terminal,
        departureGate: flight.departureGate?.trim() || depFallback.gate,
        arrivalTerminal: flight.arrivalTerminal?.trim() || arrFallback.terminal,
        arrivalGate: flight.arrivalGate?.trim() || arrFallback.gate,
    };
}
```

In `lib/flightPhase.ts`:
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

export function flightPhaseAt(flight: FlightPhaseInput, renderedAt: number): FlightPhase {
    if (flight.status === 'CANCELLED') return 'CANCELLED';

    const departureInstant = flight.estimatedDeparture
        ? new Date(flight.estimatedDeparture).getTime()
        : new Date(flight.departureDate).getTime();

    if (flight.actualArrival) return 'ARRIVED';

    if (flight.actualDeparture) {
        if (flight.durationMinutes === null || flight.durationMinutes === undefined) {
            return 'DEPARTED';
        }
        const actualArrivalAt = new Date(flight.actualDeparture).getTime() + flight.durationMinutes * 60_000;
        return renderedAt < actualArrivalAt ? 'DEPARTED' : 'ARRIVED';
    }

    if (flight.status === 'DELAYED' && !flight.estimatedDeparture) {
        return 'DELAYED';
    }

    // Boarding window: 45 minutes prior to departure until departure
    const boardingStart = departureInstant - 45 * 60_000;
    if (renderedAt >= boardingStart && renderedAt < departureInstant) {
        return 'BOARDING';
    }

    if (renderedAt < boardingStart) {
        return flight.status === 'DELAYED' ? 'DELAYED' : 'UPCOMING';
    }

    if (flight.durationMinutes === null || flight.durationMinutes === undefined) {
        return 'DEPARTED';
    }

    const arrivalAt = departureInstant + flight.durationMinutes * 60_000;
    return renderedAt < arrivalAt ? 'DEPARTED' : 'ARRIVED';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/flightGates.test.ts __tests__/lib/flightPhase.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/flightGates.ts lib/flightPhase.ts __tests__/lib/flightGates.test.ts __tests__/lib/flightPhase.test.ts
git commit -m "feat(flights): add deterministic gate fallbacks and boarding phase (#351)"
```

---

### Task 3: Validation Schemas & Flight Status Server Action

**Files:**
- Modify: `lib/validation.ts`
- Create: `lib/flightStatusService.ts`
- Modify: `app/actions.ts`
- Test: `__tests__/lib/validation.test.ts`
- Test: `__tests__/lib/flightStatusService.database.test.ts`
- Test: `__tests__/app/actions.test.ts`

**Interfaces:**
- Consumes: `flightStatusSearchSchema`, `Flight` query.
- Produces:
  - `flightStatusSearchSchema`: Zod schema for flight status search.
  - `FlightStatusService.searchFlightStatus(input, renderedAt): Promise<FlightStatusResult[]>`
  - `searchFlightStatusAction(input): Promise<ActionResult<FlightStatusResult[]>>`

- [ ] **Step 1: Write failing tests for validation schema and search action**

In `__tests__/lib/validation.test.ts`:
```ts
describe('flightStatusSearchSchema', () => {
    it('validates search by flight number', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: 'MA101',
            date: '2026-07-15',
        });
        expect(parsed.success).toBe(true);
    });

    it('validates search by route', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'SEA',
            to: 'DTW',
            date: '2026-07-15',
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects identical origin and destination airports', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'SEA',
            to: 'SEA',
        });
        expect(parsed.success).toBe(false);
    });
});
```

Create `__tests__/lib/flightStatusService.database.test.ts`:
```ts
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { FlightStatusService } from '@/lib/flightStatusService';

describe('FlightStatusService', () => {
    const flightNumber = `FS-TEST-${Date.now()}`;

    beforeAll(async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        await prisma.flight.create({
            data: {
                flightNumber,
                airline: 'Mona Airways',
                ...route,
                departureDate: new Date('2026-08-10T15:00:00.000Z'),
                durationMinutes: 240,
                priceCents: 30000,
                status: 'ON_TIME',
            },
        });
    });

    afterAll(async () => {
        await prisma.flight.deleteMany({ where: { flightNumber } });
    });

    it('finds flight status by flight number and date', async () => {
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'flightNumber',
            flightNumber,
            date: '2026-08-10',
        }, Date.parse('2026-08-10T12:00:00.000Z'));

        expect(results).toHaveLength(1);
        expect(results[0].flightNumber).toBe(flightNumber);
        expect(results[0].gates.departureGate).toBeDefined();
        expect(results[0].phase).toBe('UPCOMING');
    });

    it('finds flight status by route', async () => {
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'route',
            from: 'SEA',
            to: 'DTW',
            date: '2026-08-10',
        }, Date.parse('2026-08-10T12:00:00.000Z'));

        const match = results.find(r => r.flightNumber === flightNumber);
        expect(match).toBeDefined();
        expect(match?.from).toBe('Seattle');
        expect(match?.to).toBe('Detroit');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:database -- __tests__/lib/flightStatusService.database.test.ts`  
Expected: FAIL (missing module and schemas).

- [ ] **Step 3: Implement validation schema, FlightStatusService, and server action**

In `lib/validation.ts`:
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

export type FlightStatusSearchInput = z.infer<typeof flightStatusSearchSchema>;
```

Create `lib/flightStatusService.ts`:
```ts
import { prisma } from '@/lib/prisma';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { flightPhaseAt, type FlightPhase } from '@/lib/flightPhase';
import { getEffectiveFlightGates, type EffectiveFlightGates } from '@/lib/flightGates';
import { airportDayBounds, durationLabel, flightArrival, flightDeparture, type LocalArrival, type LocalDeparture } from '@/lib/flightTime';
import { airportTimeZoneFor } from '@/lib/airports';
import type { FlightStatusSearchInput } from '@/lib/validation';
import type { FlightStatus } from '@prisma/client';

export interface FlightStatusResult {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    fromAirportCode: string;
    toAirportCode: string;
    departureDate: string;
    durationMinutes: number | null;
    durationFormatted: string;
    status: FlightStatus;
    phase: FlightPhase;
    delayReason: string | null;
    estimatedDeparture: string | null;
    actualDeparture: string | null;
    estimatedArrival: string | null;
    actualArrival: string | null;
    departure: LocalDeparture;
    arrival: LocalArrival | null;
    gates: EffectiveFlightGates;
}

export class FlightStatusService {
    static async searchFlightStatus(
        input: FlightStatusSearchInput,
        renderedAt: number
    ): Promise<FlightStatusResult[]> {
        const whereClause: any = {};

        if (input.mode === 'flightNumber') {
            const cleanNumber = input.flightNumber.replace(/\s+/g, '').toUpperCase();
            whereClause.flightNumber = {
                equals: cleanNumber,
                mode: 'insensitive',
            };

            if (input.date) {
                // Find airport zone for bounding search or default to UTC
                const candidate = await prisma.flight.findFirst({
                    where: { flightNumber: { equals: cleanNumber, mode: 'insensitive' } },
                    select: { fromAirportCode: true },
                });
                const zone = candidate ? airportTimeZoneFor(candidate.fromAirportCode) : 'UTC';
                const { start, end } = airportDayBounds(input.date, zone);
                whereClause.departureDate = { gte: start, lte: end };
            } else {
                whereClause.departureDate = {
                    gte: new Date(renderedAt - 24 * 60 * 60 * 1000),
                    lte: new Date(renderedAt + 48 * 60 * 60 * 1000),
                };
            }
        } else {
            whereClause.fromAirportCode = input.from.toUpperCase();
            whereClause.toAirportCode = input.to.toUpperCase();

            const zone = airportTimeZoneFor(input.from);
            const dateStr = input.date || new Date(renderedAt).toISOString().slice(0, 10);
            const { start, end } = airportDayBounds(dateStr, zone);
            whereClause.departureDate = { gte: start, lte: end };
        }

        const flights = await prisma.flight.findMany({
            where: whereClause,
            orderBy: { departureDate: 'asc' },
            take: 50,
            include: flightRouteInclude,
        });

        return flights.map((flight) => {
            const routed = withRouteLabels(flight);
            const dep = flightDeparture(routed);
            const arr = routed.durationMinutes ? flightArrival({
                departureDate: routed.departureDate,
                durationMinutes: routed.durationMinutes,
                from: routed.from,
                to: routed.to,
            }) : null;

            const phase = flightPhaseAt(routed, renderedAt);
            const gates = getEffectiveFlightGates(flight);

            return {
                id: routed.id,
                flightNumber: routed.flightNumber,
                airline: routed.airline,
                from: routed.from,
                to: routed.to,
                fromAirportCode: flight.fromAirportCode,
                toAirportCode: flight.toAirportCode,
                departureDate: routed.departureDate.toISOString(),
                durationMinutes: routed.durationMinutes,
                durationFormatted: routed.durationMinutes ? durationLabel(routed.durationMinutes) : 'N/A',
                status: routed.status,
                phase,
                delayReason: flight.delayReason,
                estimatedDeparture: flight.estimatedDeparture?.toISOString() || null,
                actualDeparture: flight.actualDeparture?.toISOString() || null,
                estimatedArrival: flight.estimatedArrival?.toISOString() || null,
                actualArrival: flight.actualArrival?.toISOString() || null,
                departure: dep,
                arrival: arr,
                gates,
            };
        });
    }
}
```

In `app/actions.ts`:
Add `searchFlightStatusAction`:
```ts
export async function searchFlightStatusAction(input: unknown): Promise<ActionResult<FlightStatusResult[]>> {
    const parseResult = flightStatusSearchSchema.safeParse(input);
    if (!parseResult.success) {
        return actionValidationFailure(parseResult.error.issues[0]?.message || 'Invalid search parameters.');
    }
    const renderedAt = await serverRenderTime();
    try {
        const results = await FlightStatusService.searchFlightStatus(parseResult.data, renderedAt);
        return { ok: true, data: results };
    } catch (error) {
        console.error('searchFlightStatusAction error:', error);
        return { ok: false, error: { code: 'SERVER_ERROR', message: 'Unable to retrieve flight status.' } };
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx jest __tests__/lib/validation.test.ts -t "flightStatusSearchSchema"
npm run test:database -- __tests__/lib/flightStatusService.database.test.ts
npx jest __tests__/app/actions.test.ts -t "searchFlightStatusAction"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation.ts lib/flightStatusService.ts app/actions.ts __tests__/lib/validation.test.ts __tests__/lib/flightStatusService.database.test.ts __tests__/app/actions.test.ts
git commit -m "feat(flights): add flight status search service and server action (#351)"
```

---

### Task 4: Public Flight Status Tracker Component & Page

**Files:**
- Create: `components/ui/FlightStatusTracker.tsx`
- Create: `app/flight-status/page.tsx`
- Modify: `app/flights/page.tsx` (permanent redirect)
- Modify: `components/ui/titlebar.tsx`
- Test: `__tests__/components/FlightStatusTracker.test.tsx`
- Test: `__tests__/components/titlebar.test.tsx`
- Test: `__tests__/app/flightsPage.test.ts`

**Interfaces:**
- Consumes: `searchFlightStatusAction`, `FlightStatusResult`.
- Produces:
  - Route `/flight-status` accessible publicly.
  - Interactive two-mode tracker with deep linking and detailed status card.

- [ ] **Step 1: Write failing unit test for FlightStatusTracker component**

Create `__tests__/components/FlightStatusTracker.test.tsx`:
```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlightStatusTracker from '@/components/ui/FlightStatusTracker';

const mockFlightResult = {
    id: 101,
    flightNumber: 'MA101',
    airline: 'Mona Airways',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    fromAirportCode: 'SEA',
    toAirportCode: 'DTW',
    departureDate: '2026-08-10T14:00:00.000Z',
    durationMinutes: 240,
    durationFormatted: '4h 00m',
    status: 'ON_TIME' as const,
    phase: 'BOARDING' as const,
    delayReason: null,
    estimatedDeparture: null,
    actualDeparture: null,
    estimatedArrival: null,
    actualArrival: null,
    departure: { date: '2026-08-10', time: '07:00', readableDate: 'Aug 10, 2026', zoneLabel: 'PDT' },
    arrival: { date: '2026-08-10', time: '14:00', readableDate: 'Aug 10, 2026', zoneLabel: 'EDT', dayOffset: 0 },
    gates: { departureTerminal: '1', departureGate: 'A8', arrivalTerminal: 'Evans', arrivalGate: 'D14' },
};

describe('FlightStatusTracker', () => {
    it('renders search mode tabs and toggles between them', () => {
        render(<FlightStatusTracker initialFlights={[]} initialSearch={null} coverage="today" />);
        expect(screen.getByRole('tab', { name: /by flight number/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /by route/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: /by route/i }));
        expect(screen.getByLabelText(/origin airport/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/destination airport/i)).toBeInTheDocument();
    });

    it('renders detailed flight card with progress and gate information', () => {
        render(<FlightStatusTracker initialFlights={[mockFlightResult]} initialSearch={{ mode: 'flightNumber', flightNumber: 'MA101' }} coverage="today" />);
        expect(screen.getByText('MA101')).toBeInTheDocument();
        expect(screen.getByText(/now boarding/i)).toBeInTheDocument();
        expect(screen.getByText(/Gate A8/i)).toBeInTheDocument();
        expect(screen.getByText(/Gate D14/i)).toBeInTheDocument();
        expect(screen.getByText(/4h 00m/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/FlightStatusTracker.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement `FlightStatusTracker.tsx`, `/flight-status`, and redirect**

1. Create `components/ui/FlightStatusTracker.tsx`:
   - Two accessible tabs (`role="tablist"`): "By Flight Number" and "By Route".
   - Form inputs with accessible labels (`aria-label`, `<label>`).
   - Deep-linking synchronization with Next.js router (`window.history.pushState` or `router.push('/flight-status?...')`).
   - Detailed status card displaying:
     - Prominent status badge (`ON_TIME`, `BOARDING`, `DEPARTED`, `ARRIVED`, `DELAYED`, `CANCELLED`).
     - Progress bar with elapsed journey position.
     - Departure column (Terminal, Gate, scheduled time, airport timezone).
     - Arrival column (Terminal, Gate, scheduled time, airport timezone).
     - Delay notice / reason banner when present.
   - Fluid zero-overflow CSS (`flex-wrap: wrap`, `min-width: 0`, responsive padding).

2. Create `app/flight-status/page.tsx`:
   - Public server component.
   - Reads search params `flight`, `from`, `to`, `date`.
   - Fetches initial server-side results through `FlightStatusService.searchFlightStatus`.
   - Renders `<FlightStatusTracker initialFlights={results} ... />`.

3. Update `app/flights/page.tsx`:
   - Redirect to `/flight-status`:
     ```ts
     import { redirect } from 'next/navigation';
     export default function FlightsPage() {
         redirect('/flight-status');
     }
     ```

4. Update `components/ui/titlebar.tsx`:
   - Update `/flights` nav link to `/flight-status`.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx jest __tests__/components/FlightStatusTracker.test.tsx
npx jest __tests__/components/titlebar.test.tsx
npx jest __tests__/app/flightsPage.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/FlightStatusTracker.tsx app/flight-status/page.tsx app/flights/page.tsx components/ui/titlebar.tsx __tests__/components/FlightStatusTracker.test.tsx __tests__/components/titlebar.test.tsx __tests__/app/flightsPage.test.ts
git commit -m "feat(ui): add FlightStatusTracker component, public /flight-status route, and redirect (#351)"
```

---

### Task 5: End-to-End User Journey Tests & Full Verification

**Files:**
- Modify: `e2e/flight-status.spec.ts`

**Interfaces:**
- Consumes: `/flight-status`, `/flights` redirect.
- Produces: E2E test verification of public status tracking and responsive layout across breakpoints.

- [ ] **Step 1: Write Playwright E2E tests in `e2e/flight-status.spec.ts`**

Update `e2e/flight-status.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { airportCodesForRoute } from '../lib/airports';

test.describe('Public Flight Status Tracker', () => {
    const flightNumber = `FS-${Date.now()}`;

    test.beforeAll(async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        await prisma.flight.create({
            data: {
                flightNumber,
                airline: 'Mona Airways',
                ...route,
                departureDate: new Date(Date.now() + 25 * 60_000), // 25m out -> BOARDING
                durationMinutes: 240,
                priceCents: 35000,
                status: 'ON_TIME',
                departureTerminal: 'Main',
                departureGate: 'B4',
                arrivalTerminal: 'Evans',
                arrivalGate: 'D12',
            },
        });
    });

    test.afterAll(async () => {
        await prisma.flight.deleteMany({ where: { flightNumber } });
    });

    test('Anonymous visitor searches by flight number and views detailed status card', async ({ page }) => {
        await page.goto('/flight-status');

        // Verify page loads without authentication
        await expect(page.getByRole('heading', { name: /flight status/i })).toBeVisible();

        // Search by flight number
        await page.getByLabel(/flight number/i).fill(flightNumber);
        await page.getByRole('button', { name: /check status/i }).click();

        // Verify detailed card displays
        await expect(page.getByText(flightNumber)).toBeVisible();
        await expect(page.getByText(/boarding/i)).toBeVisible();
        await expect(page.getByText(/Gate B4/i)).toBeVisible();
        await expect(page.getByText(/Gate D12/i)).toBeVisible();
    });

    test('Anonymous visitor searches by route and deep links directly via URL', async ({ page }) => {
        // Deep-link directly via URL
        await page.goto(`/flight-status?from=SEA&to=DTW`);

        await expect(page.getByText(flightNumber)).toBeVisible();
    });

    test('Legacy /flights redirects cleanly to /flight-status', async ({ page }) => {
        await page.goto('/flights');
        await expect(page).toHaveURL(/\/flight-status/);
    });

    test('Flight status page has zero horizontal overflow across breakpoints', async ({ page }) => {
        await page.goto(`/flight-status?flight=${flightNumber}`);

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

Run: `CI=1 npx playwright test e2e/flight-status.spec.ts --reporter=list`  
Expected: PASS (all tests pass).

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
git add e2e/flight-status.spec.ts
git commit -m "test(e2e): add end-to-end and responsive tests for public flight status tracker (#351)"
```

---

### Task 6: Whole-Branch Review, PR Creation & Finishing Branch

**Files:**
- Ledger: `.superpowers/sdd/2026-09-19-flight-status-tracker/progress.md`

- [ ] **Step 1: Whole-Branch Review Package & Dispatch**

```bash
scripts/review-package docs/superpowers/plans/2026-09-19-flight-status-tracker.md $(git merge-base main HEAD) HEAD
```
Dispatch Senior Code Reviewer on `pro` model.

- [ ] **Step 2: Push branch to origin**

```bash
git push -u origin scottdensmore/feat/flight-status-tracker
```

- [ ] **Step 3: Create GitHub Pull Request**

```bash
gh pr create --title "feat(flights): add public flight status tracker and search by flight number or route (#351)" --body "Resolves #351..."
```
