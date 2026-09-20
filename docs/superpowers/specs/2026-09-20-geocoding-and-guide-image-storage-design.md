# Design Specification: Server-Side Geocoding Boundary & Managed Guide Image Storage

**Date:** 2026-09-20  
**Status:** Approved  
**Related Issue:** #82 (P3.5 Make guides and notifications production-ready - Sub-Project 1)

---

## 1. Context & Motivation

In the current codebase:
1. **Unrestricted Geocoding from Client**: [`components/ui/travelGuideForm.tsx`](../../components/ui/travelGuideForm.tsx) performs direct client-side `fetch` calls to `https://nominatim.openstreetmap.org/search`. This violates OpenStreetMap's Nominatim usage policy (which requires rate limiting to max 1 req/sec, mandatory caching of duplicate queries, and custom application User-Agent headers). Furthermore, it exposes Nominatim in the client Content Security Policy (`connect-src`), exposing client IPs and relying on browser connectivity.
2. **Unrestricted Guide Images**: The `coverImage` attribute in `CityGuide` permits arbitrary external URLs or raw data URLs. While basic data URL format checking was added, arbitrary external `https://` URLs remain permitted, risking dead images, slow external fetches, and lack of content provenance.

This specification establishes:
- A server-side geocoding service boundary with in-memory TTL caching, request throttling (&le; 1 req/sec), custom `User-Agent` headers, graceful airport fallback, and required provider attribution ("Data © OpenStreetMap contributors, ODbL 1.0").
- A managed guide image storage pipeline using existing magic byte validation ([`lib/uploadValidation.ts`](../../lib/uploadValidation.ts)), saving validated files to `public/uploads/guides/[hash].[ext]` and eliminating arbitrary external image URLs.
- Removal of Nominatim from client-facing CSP headers.

---

## 2. Architecture & Detailed Design

### 2.1 Server-Side Geocoding Service (`lib/geocodingService.ts`)

#### Responsibilities
- Manage rate-limited communication with OpenStreetMap Nominatim.
- Provide an in-memory TTL cache to eliminate redundant network queries.
- Fall back gracefully to airport database / seed coordinates when Nominatim is unavailable or times out.
- Ensure all queries comply with OpenStreetMap Nominatim Usage Policy.

#### Interfaces & Types
```typescript
export interface GeocodeQuery {
    city: string;
    country: string;
}

export interface GeocodeResult {
    latitude: number;
    longitude: number;
    attribution: string;
    source: 'nominatim' | 'cache' | 'fallback';
}

export interface GeocodeError {
    error: string;
    details?: string;
}
```

#### Rate Limiting & Queueing
- Maintain `lastRequestTime: number` and a Promise chain/queue ensuring minimum interval of 1,000ms between outbound requests to Nominatim.
- Outbound fetch includes:
  - Header: `User-Agent: MonaAirways-TravelApp/1.0 (+https://github.com/scottdensmore/travel-app; support@monaairways.com)`
  - Timeout: 4,000ms abort signal.

#### In-Memory TTL Cache
- Cache key: `${normalize(city)}:${normalize(country)}`.
- Successful lookups cached for 24 hours (86,400,000 ms).
- Not-found lookups cached for 5 minutes (300,000 ms) to avoid hammering upstream on invalid locations.

#### Graceful Degradation / Local Fallback
- If Nominatim returns HTTP status != 200, times out, or throws network errors:
  1. Inspect seeded `Airport` records in database (or cached airport definitions in `lib/airports.ts`) matching city/country names.
  2. Inspect existing `CityGuide` records with valid `latlong`.
  3. If found, return coordinates with `source: 'fallback'` and standard attribution.
  4. If not found, return clean domain error without crashing.

---

### 2.2 Server Action (`app/actions.ts`)

#### `geocodeCityAction`
```typescript
export async function geocodeCityAction(query: { city: string; country: string }): Promise<ActionResult<GeocodeResult>> {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) {
        throw new Error("Unauthorized");
    }

    const parsed = parseActionInput(geocodeQuerySchema, query);
    if (!parsed.ok) return parsed;

    return await geocodingService.lookup(parsed.data.city, parsed.data.country);
}
```

- Validation Schema:
  - `city`: text between 1 and 100 characters.
  - `country`: text between 1 and 100 characters.

---

### 2.3 Managed Guide Image Storage (`lib/guideImageStorage.ts`)

#### Storage Location
- Root directory: `public/uploads/guides/`.
- Git configuration: Add `public/uploads/guides/*` to `.gitignore`, keeping `public/uploads/guides/.gitkeep`.

#### Processing Workflow
1. Client sends image payload (either base64 data URL or binary buffer) to `saveCityGuideAction`.
2. `saveGuideImage(payload: string | Buffer)`:
   - Validates size (&le; 512,000 bytes / 500 KB).
   - Validates file signatures via `validateImageBuffer` (detects JPEG, PNG, WebP, AVIF; rejects SVG and polyglots).
   - Computes SHA-256 hash of content: `hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16)`.
   - Generates filename: `guide-${hash}.${extension}`.
   - Writes file atomically to `public/uploads/guides/${filename}`.
   - Returns relative path `/uploads/guides/${filename}`.
3. `CityGuide.coverImage` in PostgreSQL stores `/uploads/guides/${filename}` (or existing seeded `/img/...` paths).

#### Schema Restriction (`lib/validation.ts`)
- `coverImageSchema` updated:
  - Validates relative paths starting with `/uploads/guides/guide-` or `/img/`.
  - Disallows raw `http://` / `https://` URLs to prevent external SSRF, tracking pixels, or broken hotlinks.
  - Accepts validated data URLs during mutation processing, which the server action transforms into a managed upload path before saving.

---

### 2.4 UI Integration (`components/ui/travelGuideForm.tsx`)

1. **Geocoding Trigger**:
   - `fetchCoordinates` calls `geocodeCityAction({ city, country })` on input blur.
   - Displays loading state while lookup is in flight.
   - Renders coordinates upon success, along with provider attribution:
     ```tsx
     <p className="text-xs text-slate-400 mt-1" data-testid="geocode-attribution">
       Location data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap</a> contributors
     </p>
     ```
2. **Error Handling**:
   - If geocoding fails, displays clear non-blocking error message allowing staff to retry or input coordinates manually.
3. **Image Upload**:
   - Keeps client-side preview via `URL.createObjectURL` or data URL.
   - Submits payload to `saveCityGuideAction`, which persists to managed storage and sets `coverImage`.

---

### 2.5 Security & Content Security Policy (`next.config.mjs`)

- Remove `https://nominatim.openstreetmap.org` from `connect-src` in `next.config.mjs`.
- CSP `connect-src` becomes:
  ```
  connect-src 'self' https://api.stripe.com
  ```
- Update `__tests__/security/securityHeaders.test.ts` to assert that `nominatim.openstreetmap.org` is no longer permitted in client CSP.

---

## 3. Testing & Verification Plan

1. **Unit Tests (`__tests__/lib/geocodingService.test.ts`)**:
   - Rate limiting: Mock two simultaneous requests; assert that the second request waits &ge; 1,000ms after the first.
   - Caching: Mock Nominatim fetch; perform two identical requests; assert upstream fetch called only once.
   - User-Agent: Verify headers include `MonaAirways-TravelApp`.
   - Fallback: Simulate upstream 503 error; assert fallback coordinates returned from airport database.
2. **Storage Tests (`__tests__/lib/guideImageStorage.test.ts`)**:
   - Test saving JPEG, PNG, WebP buffers.
   - Test deterministic hash naming (`guide-[hash].[ext]`).
   - Test polyglot rejection (HTML in PNG, SVG masquerading as image).
   - Test size limits (> 500 KB rejected).
3. **Form Tests (`__tests__/components/travelGuideForm.test.tsx`)**:
   - Update tests to verify `geocodeCityAction` mock integration and attribution display.
4. **Security Tests (`__tests__/security/securityHeaders.test.ts`)**:
   - Verify CSP headers lack `nominatim.openstreetmap.org`.
5. **Full Baseline Verification**:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run test:unit`
   - `npm run test:database`
