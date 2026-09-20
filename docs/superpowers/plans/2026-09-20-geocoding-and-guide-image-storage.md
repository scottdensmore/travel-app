# Server-Side Geocoding Boundary & Managed Guide Image Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a secure server-side geocoding service with rate-limiting (&le; 1 req/sec), caching, provider attribution, and graceful fallback; implement managed guide image storage using magic byte inspection and hash-based file persistence; integrate with the guide authoring form; and remove Nominatim from client CSP.

**Architecture:** A singleton `GeocodingService` manages in-memory TTL caching, request throttling, and fallback lookups for OpenStreetMap Nominatim. `guideImageStorage` processes image data, enforces magic byte security, and stores files to `public/uploads/guides/` with deterministic hash names. `travelGuideForm` calls `geocodeCityAction` instead of direct browser `fetch` and displays OpenStreetMap attribution. `next.config.mjs` removes Nominatim from client `connect-src`.

**Tech Stack:** TypeScript, Next.js 14 (Server Actions), Zod, Node.js `crypto` & `fs/promises`, Jest.

**Spec:** [`docs/superpowers/specs/2026-09-20-geocoding-and-guide-image-storage-design.md`](../specs/2026-09-20-geocoding-and-guide-image-storage-design.md)

## Global Constraints

- Never expose direct client calls to Nominatim; all geocoding must route through the rate-limited server boundary.
- All requests to Nominatim must send `User-Agent: MonaAirways-TravelApp/1.0 (+https://github.com/scottdensmore/travel-app; support@monaairways.com)`.
- Respect OpenStreetMap's 1-request-per-second rate limit using an in-process throttle.
- All guide cover images must pass magic byte inspection (&le; 500 KB, JPEG/PNG/WebP/AVIF) and be stored in `public/uploads/guides/` with content-hashed filenames.
- Disallow arbitrary external `https://` URLs in `coverImageSchema`.
- Display explicit attribution: "Location data © OpenStreetMap contributors" when displaying geocoded coordinates.
- Follow strict TDD: write failing test (RED), implement minimal code (GREEN), verify, commit.

---

### Task 1: Server-Side Geocoding Service (`lib/geocodingService.ts`)

**Files:**
- Create: `lib/geocodingService.ts`
- Test: `__tests__/lib/geocodingService.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface GeocodeResult {
      latitude: number;
      longitude: number;
      attribution: string;
      source: 'nominatim' | 'cache' | 'fallback';
  }

  export class GeocodingService {
      constructor(options?: { minRequestIntervalMs?: number; cacheTtlMs?: number; negativeTtlMs?: number });
      lookup(city: string, country: string): Promise<GeocodeResult>;
      clearCache(): void;
  }

  export const geocodingService: GeocodingService;
  ```

- [ ] **Step 1: Write the failing unit tests for `GeocodingService`**

Create `__tests__/lib/geocodingService.test.ts` covering:
1. Successful lookup with custom User-Agent and attribution.
2. In-memory caching: second identical lookup uses cache without calling upstream fetch.
3. Rate-limiting: two simultaneous calls are spaced by at least `minRequestIntervalMs`.
4. Graceful fallback: when upstream returns 500/network error, falls back to matching airport coordinates.
5. Error handling: returns clean error if city not found and no fallback exists.

```typescript
import { GeocodingService } from '@/lib/geocodingService';

describe('GeocodingService', () => {
    let service: GeocodingService;
    const originalFetch = global.fetch;

    beforeEach(() => {
        service = new GeocodingService({ minRequestIntervalMs: 50, cacheTtlMs: 5000 });
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('queries Nominatim with User-Agent and returns formatted coordinates with attribution', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '47.6062', lon: '-122.3321' }],
        } as Response);

        const result = await service.lookup('Seattle', 'USA');

        expect(result).toEqual({
            latitude: 47.6062,
            longitude: -122.3321,
            attribution: 'Data © OpenStreetMap contributors, ODbL 1.0',
            source: 'nominatim',
        });

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('q=Seattle%2CUSA'),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'User-Agent': expect.stringContaining('MonaAirways-TravelApp'),
                }),
            })
        );
    });

    it('returns cached coordinates on repeated queries', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '47.6062', lon: '-122.3321' }],
        } as Response);

        const first = await service.lookup('Seattle', 'USA');
        const second = await service.lookup('seattle ', 'usa');

        expect(first.source).toBe('nominatim');
        expect(second.source).toBe('cache');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('throttles rapid sequential requests to enforce rate limits', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '10.0', lon: '20.0' }],
        } as Response);

        const start = Date.now();
        await Promise.all([
            service.lookup('CityA', 'CountryA'),
            service.lookup('CityB', 'CountryB'),
        ]);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(45);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('falls back gracefully to seeded airport coordinates when Nominatim fails', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

        const result = await service.lookup('Detroit', 'USA');

        expect(result.source).toBe('fallback');
        expect(result.latitude).toBeCloseTo(42.2124, 2);
        expect(result.longitude).toBeCloseTo(-83.3534, 2);
        expect(result.attribution).toContain('OpenStreetMap');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/geocodingService.test.ts`
Expected: FAIL (Cannot find module `@/lib/geocodingService`).

- [ ] **Step 3: Implement `GeocodingService`**

Create `lib/geocodingService.ts`:
- Implement class with rate limit promise queue.
- Implement cache map with expiry timestamps.
- Implement fallback coordinate lookup using `airports` map from `lib/airports.ts`.
- Export singleton instance `geocodingService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/geocodingService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/geocodingService.ts __tests__/lib/geocodingService.test.ts
git commit -m "feat(geocoding): add cached rate-limited server geocoding service (#82)"
```

---

### Task 2: Geocoding Server Action & Zod Validation (`app/actions.ts`, `lib/validation.ts`)

**Files:**
- Modify: `lib/validation.ts`
- Modify: `app/actions.ts`
- Test: `__tests__/lib/geocodingAction.test.ts`

**Interfaces:**
- Consumes: `geocodingService` from `lib/geocodingService.ts`
- Produces:
  ```typescript
  export async function geocodeCityAction(query: { city: string; country: string }): Promise<ActionResult<GeocodeResult>>;
  ```

- [ ] **Step 1: Write the failing test for `geocodeCityAction`**

Create `__tests__/lib/geocodingAction.test.ts` verifying:
1. Rejection when unauthenticated or non-staff.
2. Validation error on empty city or country.
3. Successful resolution delegating to `geocodingService`.

```typescript
import { geocodeCityAction } from '@/app/actions';
import { geocodingService } from '@/lib/geocodingService';
import { getServerSession } from 'next-auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAccess';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/staffAccess', () => ({
    hasVerifiedStaffAccess: jest.fn(),
}));

jest.mock('@/lib/geocodingService', () => ({
    geocodingService: {
        lookup: jest.fn(),
    },
}));

describe('geocodeCityAction', () => {
    it('rejects unauthorized requests without staff verification', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(false);

        await expect(geocodeCityAction({ city: 'Seattle', country: 'USA' })).rejects.toThrow('Unauthorized');
    });

    it('validates city and country parameters', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN' } });
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(true);

        const result = await geocodeCityAction({ city: '', country: 'USA' });
        expect(result).toHaveProperty('ok', false);
    });

    it('executes geocoding lookup for authorized staff', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN' } });
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(true);
        (geocodingService.lookup as jest.Mock).mockResolvedValue({
            latitude: 47.6062,
            longitude: -122.3321,
            attribution: 'Data © OpenStreetMap contributors',
            source: 'nominatim',
        });

        const result = await geocodeCityAction({ city: 'Seattle', country: 'USA' });
        expect(result).toEqual({
            latitude: 47.6062,
            longitude: -122.3321,
            attribution: 'Data © OpenStreetMap contributors',
            source: 'nominatim',
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/geocodingAction.test.ts`
Expected: FAIL (`geocodeCityAction` is not a function).

- [ ] **Step 3: Implement validation schema and server action**

1. In `lib/validation.ts`:
   Add and export `geocodeQuerySchema`:
   ```typescript
   export const geocodeQuerySchema = z.object({
       city: requiredText('City', 100),
       country: requiredText('Country', 100),
   }).strict();
   ```
2. In `app/actions.ts`:
   Implement `geocodeCityAction(query: { city: string; country: string })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/geocodingAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation.ts app/actions.ts __tests__/lib/geocodingAction.test.ts
git commit -m "feat(geocoding): add authenticated geocodeCityAction server action (#82)"
```

---

### Task 3: Managed Guide Image Storage (`lib/guideImageStorage.ts`, `lib/validation.ts`)

**Files:**
- Create: `lib/guideImageStorage.ts`
- Modify: `lib/validation.ts:177-214`
- Modify: `.gitignore`
- Test: `__tests__/lib/guideImageStorage.test.ts`

**Interfaces:**
- Consumes: `validateImageBuffer`, `DEFAULT_MAX_UPLOAD_BYTES` from `lib/uploadValidation.ts`
- Produces:
  ```typescript
  export async function saveGuideImage(payload: string | Buffer): Promise<string>;
  export function isManagedGuideImagePath(path: string): boolean;
  ```

- [ ] **Step 1: Write the failing test for `saveGuideImage` and schema validation**

Create `__tests__/lib/guideImageStorage.test.ts` verifying:
1. Valid JPEG/PNG/WebP/AVIF buffer is saved to `public/uploads/guides/guide-[16-char-hash].[ext]`.
2. Deterministic hashing: same content produces same path.
3. Rejection of files exceeding 500 KB (`DEFAULT_MAX_UPLOAD_BYTES`).
4. Rejection of polyglot content (SVG, HTML/JS payloads).
5. Schema validation in `coverImageSchema`: allows `/uploads/guides/guide-...` and `/img/...`, rejects external `https://` URLs.

```typescript
import { saveGuideImage, isManagedGuideImagePath } from '@/lib/guideImageStorage';
import { coverImageSchema } from '@/lib/validation';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('guideImageStorage', () => {
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

    it('saves a valid PNG buffer to managed storage with deterministic hash', async () => {
        const filePath = await saveGuideImage(validPngHeader);
        expect(filePath).toMatch(/^\/uploads\/guides\/guide-[a-f0-9]{16}\.png$/);
        expect(isManagedGuideImagePath(filePath)).toBe(true);

        const diskPath = path.join(process.cwd(), 'public', filePath.replace(/^\//, ''));
        const exists = await fs.stat(diskPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        // Cleanup
        await fs.unlink(diskPath).catch(() => {});
    });

    it('rejects polyglot payloads containing executable HTML/scripts', async () => {
        const polyglot = Buffer.concat([validPngHeader, Buffer.from('<script>alert("xss")</script>')]);
        await expect(saveGuideImage(polyglot)).rejects.toThrow(/prohibited markup|invalid image/i);
    });

    it('rejects files exceeding max upload size limit', async () => {
        const oversized = Buffer.alloc(600 * 1024, 0);
        await expect(saveGuideImage(oversized)).rejects.toThrow(/500 KB or smaller/i);
    });

    it('updates coverImageSchema to reject unmanaged external URLs', () => {
        expect(coverImageSchema.safeParse('https://malicious.com/image.jpg').success).toBe(false);
        expect(coverImageSchema.safeParse('/img/my-profile-photo.jpg').success).toBe(true);
        expect(coverImageSchema.safeParse('/uploads/guides/guide-1234567890abcdef.png').success).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/guideImageStorage.test.ts`
Expected: FAIL (Module `@/lib/guideImageStorage` does not exist).

- [ ] **Step 3: Implement `guideImageStorage.ts` and update `coverImageSchema`**

1. Create `public/uploads/guides/.gitkeep` if it doesn't exist.
2. In `.gitignore`, add:
   ```
   # Managed user uploads
   public/uploads/guides/*
   !public/uploads/guides/.gitkeep
   ```
3. Create `lib/guideImageStorage.ts`:
   - Implement `saveGuideImage(payload)` validating buffer with `validateImageBuffer`.
   - Calculate SHA-256 hash slice(0, 16).
   - Write to `public/uploads/guides/guide-${hash}.${ext}`.
4. Update `coverImageSchema` in `lib/validation.ts` to allow `/uploads/guides/guide-[a-f0-9]{16}\.(jpe?g|png|webp|avif)$`, allow `/img/...`, accept data URLs for transformation, and reject arbitrary `http://` / `https://` URLs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/guideImageStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guideImageStorage.ts lib/validation.ts .gitignore __tests__/lib/guideImageStorage.test.ts public/uploads/guides/.gitkeep
git commit -m "feat(storage): add managed guide image storage with magic byte validation (#82)"
```

---

### Task 4: Server Action & Form Integration (`app/actions.ts`, `components/ui/travelGuideForm.tsx`)

**Files:**
- Modify: `app/actions.ts:147-158`
- Modify: `components/ui/travelGuideForm.tsx:85-115, 120-136, 180-185`
- Test: `__tests__/components/travelGuideForm.test.tsx`

**Interfaces:**
- Consumes: `geocodeCityAction` from `app/actions.ts`, `saveGuideImage` from `lib/guideImageStorage.ts`
- Produces: Updated `travelGuideForm.tsx` calling `geocodeCityAction` with OpenStreetMap attribution and managed upload saving.

- [ ] **Step 1: Write the failing test for form geocoding integration and attribution**

Update `__tests__/components/travelGuideForm.test.tsx`:
- Mock `geocodeCityAction`.
- Verify form calls `geocodeCityAction({ city, country })` on blur.
- Verify attribution badge "Location data © OpenStreetMap contributors" is rendered with link to `https://www.openstreetmap.org/copyright`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/travelGuideForm.test.tsx`
Expected: FAIL (attributon element not found).

- [ ] **Step 3: Update `saveCityGuideAction` and `travelGuideForm.tsx`**

1. In `app/actions.ts`:
   In `saveCityGuideAction`: If `cityGuide.coverImage` is a data URL, call `await saveGuideImage(cityGuide.coverImage)` and assign the returned path to `cityGuide.coverImage` before validating and writing to Prisma.
2. In `components/ui/travelGuideForm.tsx`:
   - Replace `fetch('https://nominatim.openstreetmap.org...')` with `await geocodeCityAction({ city: cityName, country: countryName })`.
   - Render attribution badge `<p data-testid="geocode-attribution" className="text-xs text-slate-400 mt-1">Location data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap</a> contributors</p>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/travelGuideForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/actions.ts components/ui/travelGuideForm.tsx __tests__/components/travelGuideForm.test.tsx
git commit -m "feat(guide): integrate server geocoding and managed storage into travel guide form (#82)"
```

---

### Task 5: Content Security Policy Hardening & Full Verification (`next.config.mjs`)

**Files:**
- Modify: `next.config.mjs:13`
- Modify: `__tests__/security/securityHeaders.test.ts:69`

**Interfaces:**
- Tightened CSP: `connect-src 'self' https://api.stripe.com`

- [ ] **Step 1: Update CSP header and security test**

1. In `next.config.mjs`:
   Change:
   ```javascript
   "connect-src 'self' https://nominatim.openstreetmap.org https://api.stripe.com",
   ```
   To:
   ```javascript
   "connect-src 'self' https://api.stripe.com",
   ```
2. In `__tests__/security/securityHeaders.test.ts`:
   Update test to verify `https://nominatim.openstreetmap.org` is NOT present in `connect-src` and only `'self'` and `https://api.stripe.com` are present.

- [ ] **Step 2: Run security test to verify it passes**

Run: `npx jest __tests__/security/securityHeaders.test.ts`
Expected: PASS.

- [ ] **Step 3: Run comprehensive verification**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:database
```
Expected: All clean (0 type errors, 0 lint warnings/errors, 131+ unit test suites passed, 49 database integration test suites passed).

- [ ] **Step 4: Commit**

```bash
git add next.config.mjs __tests__/security/securityHeaders.test.ts
git commit -m "sec(csp): remove direct nominatim connect-src permission (#82)"
```
