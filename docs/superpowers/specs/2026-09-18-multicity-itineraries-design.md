# Specification: Multi-City Itineraries (#131)

**Date:** 2026-09-18  
**Status:** Approved  
**Related Issue:** #131  

---

## 1. Overview & Objectives

Enable customers to search, assemble, and book multi-city stopover flight itineraries (2 to 5 legs) directly within Mona Airways. 

### Key Capabilities
- Multi-city search with dynamic leg rows (minimum 2, maximum 5).
- Auto-populating consecutive leg origins from preceding destinations, with full support for open-jaw itineraries.
- Date ordering enforcement across consecutive legs (`Date(Leg N) >= Date(Leg N-1)`).
- Concurrent leg search execution with independent leg degradation on partial outages.
- Step-by-step progressive disclosure leg selection with a persistent, interactive itinerary summary bar and running total price.
- Generalization of `/checkout` query parameters (`flights=id1,id2,id3...`) with backward compatibility for legacy `outbound` and `inbound` links.
- End-to-end checkout, seat selection per leg, payment processing, and profile display for multi-leg journeys.

---

## 2. Architecture & Data Model

### 2.1 Validation Limits (`lib/validation.ts`)
- **`MAX_ITINERARY_LEGS`**: Raised from `2` to `5`.
- **`multiCityLegSchema`**:
  - `from`: string, 1–128 chars.
  - `to`: string, 1–128 chars.
  - `departureDate`: valid `YYYY-MM-DD` date string within booking window.
  - Refinement: `from !== to` (origin and destination must differ).
- **`searchMultiCityFlightsSchema`**:
  - `legs`: array of `multiCityLegSchema`, minimum 2, maximum 5 (`MAX_ITINERARY_LEGS`).
  - `cabinClass`: optional enum (`ECONOMY`, `PREMIUM_ECONOMY`, `BUSINESS`, `FIRST`).
  - Super-refinement: verifies date order `legs[i].departureDate >= legs[i - 1].departureDate` for all `i >= 1`.
- **`bookingRequestSchema` & `flightBookingServiceSchema`**:
  - Automatically support up to 5 flight IDs (`flightIds.length <= MAX_ITINERARY_LEGS`).
  - Enforce `passenger.seatNumbers.length === flightIds.length` for every traveler.

### 2.2 Server Action & Search API (`app/actions.ts`)
- **Action:** `searchMultiCityFlightsAction(legs, cabinClass)`
- **Types:**
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
        };

  export interface MultiCitySearchResponse {
      legs: MultiCityLegSearchResult[];
      cabinClass?: CabinClass;
  }
  ```
- **Execution:**
  - Parallel query dispatch via `Promise.allSettled(legs.map(...))`.
  - Fault tolerance: a failure on leg *i* returns `{ status: 'unavailable' }` for that leg without failing healthy legs.
  - Applies cabin pricing adjustments and filters non-operating cabins via `flightsForCabin`.

---

## 3. User Interface & User Experience

### 3.1 Search Form (`components/ui/flightBookingForm.tsx`)
- **Trip Type Radio Group:**
  - Radios: `Round Trip`, `One Way`, `Multi-city`.
  - Selecting `Multi-city` toggles form layout to dynamic leg rows.
- **Dynamic Leg Rows:**
  - Initial state: 2 legs.
  - Each row contains:
    - Leg badge (e.g. `Flight 1`, `Flight 2`).
    - Origin (`From`) dropdown / autocomplete.
    - Destination (`To`) dropdown / autocomplete.
    - Departure date picker with validation constraints.
    - "Remove Flight" button (visible when total legs > 2).
  - "Add Flight" button (visible when total legs < 5):
    - Appends a new leg with origin defaulted to previous leg's destination and departure date defaulted to previous leg's date.
- **Form Submission:**
  - Calls `searchMultiCityFlightsAction` with loading indicators and `aria-busy`.

### 3.2 Step-by-Step Leg Selection
- **Itinerary Progress Header:**
  - Top persistent bar summarizing the overall route chain (e.g., `Seattle (SEA) → Detroit (DTW) → New York (JFK) → Seattle (SEA)`).
  - Step indicator: `Step X of N: Select Flight from <Origin> to <Destination>`.
  - Running total price: `Itinerary Total: $XXX`.
  - Clickable step chips allow jumping back to edit previously selected legs.
- **Active Leg Results:**
  - Displays matching flights for the current step.
  - Selecting a flight saves it into the active selection and advances to the next unselected leg.
- **Completion State:**
  - When all legs are selected, the progress header highlights all choices and presents the primary call-to-action: `"Review & Book Itinerary →"`.
  - Navigates to `/checkout?flights=${selectedFlightIds.join(',')}&cabin=${selectedCabin}`.

---

## 4. Checkout & Downstream Integration

### 4.1 Route Parameters (`app/checkout/page.tsx`)
- **Search Parameters:**
  - Supports `flights`: comma-delimited (`flights=101,102,103`) or repeated (`flights=101&flights=102`).
  - Validates positive integer IDs, count between 1 and 5 (`MAX_ITINERARY_LEGS`), and uniqueness.
  - Backward compatibility: if `flights` is missing, falls back to legacy `outbound` and `inbound` parameters.
- **Data Hydration:**
  - Queries `prisma.flight` for all flight IDs in exact itinerary sequence.
  - Fetches occupied seats concurrently across all legs.

### 4.2 Checkout Wizard & Profile Display
- **`BookingCheckoutWizard`:**
  - Renders leg tabs for seat maps across all *N* legs.
  - Calculates total price using `calculateItineraryTotal`.
  - Passes all flight IDs to payment intent metadata and `checkoutPaymentAction`.
- **`ProfileClient`:**
  - Displays each leg in the booked itinerary with flight number, route, departure, seat, and status.

---

## 5. Verification & Testing Strategy

### 5.1 Unit Tests
- `__tests__/lib/validation.test.ts`:
  - Verify `MAX_ITINERARY_LEGS = 5`.
  - Verify `searchMultiCityFlightsSchema` (min 2, max 5, route distinctness, date ordering).
- `__tests__/app/actions.test.ts`:
  - `searchMultiCityFlightsAction` parallel search, cabin filtering, and partial failure handling.
- `__tests__/components/flightBookingForm.test.tsx`:
  - Multi-city radio selection, dynamic leg addition/removal, auto-population of origin, step-by-step leg selection, and running total calculation.
- `__tests__/app/checkoutPage.test.tsx`:
  - `flights` query parameter parsing, leg ordering, out-of-bounds rejection, and backward compatibility with `outbound`/`inbound`.

### 5.2 Database Tests
- `__tests__/lib/FlightBookingService.database.test.ts`:
  - End-to-end multi-leg booking creation against PostgreSQL with 3 and 4 legs, verifying `ItineraryLeg` records and seat assignments.

### 5.3 End-to-End Playwright Journey
- `e2e/multicity.spec.ts`:
  - User visits `/`, switches to "Multi-city", adds a 3rd leg.
  - Submits search, selects flights sequentially across all 3 legs.
  - Verifies running total price, proceeds to checkout.
  - Enters traveler info, chooses seats on all 3 legs.
  - Submits payment, verifies booking confirmation.
  - Navigates to `/profile` and verifies all 3 legs display with proper flight numbers and seats.
  - Verifies responsive layout at 320px, 390px, and 1280px widths.
