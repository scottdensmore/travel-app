# Travel App Real-World Roadmap

This roadmap tracks the work required to turn the original demo into a
trustworthy, production-oriented travel application. Check an item only after
its acceptance criteria are met and its tests have passed.

## How to use this roadmap

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked; add the reason to the progress log
- Complete phases in priority order unless a later item is an explicit
  prerequisite for current work.
- Give each implementation PR one primary roadmap item or one tightly related
  group of items.
- Add the PR number and completion date to the progress log.
- Follow the repository's test-first, verification, review, and squash-merge
  rules for every implementation change.

## Sources of truth

- GitHub CI is the source of truth for current test counts and build, lint,
  type-check, migration, audit, browser, and container status.
- Pull requests record the verification performed for each delivered change.
- The phase checklists and progress log below are the only tracking lists for
  remaining product work; do not duplicate those gaps in a separate baseline.

## Phase 0: Security and correctness

Goal: remove immediate security risks and make server-side behavior
authoritative before expanding the product.

### P0.1 Protect build and runtime secrets

- [x] Exclude `.env` and `.env*` from the Docker build context.
- [x] Ensure `.next/standalone` and the final image contain no environment
  files or secret values.
- [x] Inject runtime configuration through the deployment environment.
- [x] Validate required environment variables during application startup.
- [x] Document secret rotation for any image that may have been published.

Acceptance criteria:

- A clean container build contains no `.env` file.
- The application starts with injected runtime values and fails clearly when a
  required value is absent.
- Automated verification checks the final image for accidentally copied secret
  files.

### P0.2 Remediate vulnerable dependencies

- [x] Upgrade Next.js and its React dependencies using the official migration
  path.
- [x] Upgrade or replace the vulnerable NextAuth/Auth dependency chain.
- [x] Upgrade or replace the vulnerable `react-simple-maps`/D3 chain.
- [x] Resolve remaining production audit findings without using an unreviewed
  forced downgrade or breaking change.
- [x] Add dependency auditing to CI.

Acceptance criteria:

- `npm audit --omit=dev` has no known high or critical findings, or every
  exception has a documented owner, mitigation, and expiry date.
- Build, Jest, and Playwright suites pass on the upgraded stack.

### P0.3 Add authoritative server validation

- [x] Introduce shared schemas for registration, reviews, favorites, city
  guides, schedules, passengers, seat changes, and booking requests.
- [x] Normalize and validate identifiers, email addresses, dates, enum values,
  text lengths, and array limits.
- [x] Return structured, customer-safe validation errors.
- [x] Add request and mutation size limits.

Acceptance criteria:

- Invalid or oversized requests are rejected on the server even when the UI is
  bypassed.
- Each schema has unit tests for valid input, boundary values, and malformed
  input.

### P0.4 Make pricing and booking authoritative

- [x] Stop accepting the final price from the browser.
- [x] Stop accepting or generating trusted payment identifiers in client code.
- [x] Load the flight, fare, cabin, and price on the server at booking time.
- [x] Verify selected seats and passenger count against available inventory.
- [x] Add an idempotency mechanism that prevents duplicate bookings.

Acceptance criteria:

- Changing client-submitted prices, cabin values, or payment identifiers cannot
  change the server-calculated booking.
- Concurrent seat-booking tests prove that only one customer can acquire a
  seat.
- Repeating the same booking request does not create duplicates.

### P0.5 Harden identity and personal data

- [x] Normalize email addresses and prevent case-variant duplicate accounts.
- [x] Add registration and authentication rate limits.
- [x] Add email verification, password reset, and recovery flows.
- [x] Use generic account-existence responses where appropriate.
- [x] Define encryption, access, retention, redaction, and deletion rules for
  passport numbers and dates of birth.
- [x] Add stronger protection for staff accounts.

Acceptance criteria:

- Authentication abuse tests cover enumeration and rate limiting.
- Sensitive passenger data is not exposed in logs, routine API responses, or
  unauthorized administration views.
- Account recovery and verified-email journeys have end-to-end coverage.

## Phase 1: Trustworthy search and purchase journey

Goal: ensure every visible booking control has real behavior and the default
journey succeeds.

### P1.1 Fix search dates and availability

- [x] Default to the next operating date for the selected route.
- [x] Prevent past departures and returns before departure.
- [ ] Add minimum/maximum booking-window rules.
- [ ] Suggest nearby operating dates when no exact match exists.
- [ ] Preserve search criteria in URL parameters.
- [ ] Add loading, empty, failure, retry, and degraded-service states.

Acceptance criteria:

- The default route/date combination produces an available flight in seeded
  environments.
- Search validation and nearby-date behavior are covered by unit and end-to-end
  tests.
- Refreshing or sharing a results URL preserves the search.

### P1.2 Model round trips correctly

- [ ] Replace the fixed seven-day `returnDate` assumption with outbound and
  inbound flight selections.
- [ ] Represent a booking as an itinerary containing one or more legs.
- [ ] Search and price both directions independently.
- [ ] Display a combined itinerary summary before checkout.

Acceptance criteria:

- A round trip contains two actual flight instances chosen by the customer.
- One-way bookings contain one leg and no synthetic return date.
- Profile, confirmation, administration, and cancellation views understand all
  itinerary legs.

### P1.3 Make every search control functional

- [ ] Make travel class affect fares, seat inventory, and checkout.
- [ ] Implement reward search and redemption, or remove the control until the
  loyalty model supports it.
- [ ] Implement multicity itineraries, or remove the dead link until the
  itinerary model supports them.
- [ ] Ensure sorting and filters reflect server-authoritative values.

Acceptance criteria:

- No primary navigation or booking control points to `#` or silently does
  nothing.
- End-to-end tests cover each control that remains visible.

### P1.4 Separate search from inventory generation

- [ ] Stop generating flight instances inside a customer search request.
- [ ] Generate future inventory through a scheduled, idempotent background job.
- [ ] Track generation success, failures, and coverage horizon.
- [x] Provide an administrative repair/rebuild operation.

Acceptance criteria:

- Repeated searches are read-only.
- Inventory generation can safely run concurrently and be retried.
- Alerts fire before the available inventory horizon becomes too short.

### P1.5 Establish one product identity

- [ ] Choose the airline/product name and update all UI, seed data, README text,
  contact information, images, and metadata.
- [ ] Define airline code, support details, legal links, and social links.
- [ ] Add page-specific titles and descriptions.
- [ ] Remove or implement placeholder footer links.

Acceptance criteria:

- No legacy Mona/Gemini/demo wording remains outside migration history.
- Every public route has meaningful metadata and working navigation.

## Phase 2: Real booking lifecycle

Goal: replace demo booking and payment behavior with explicit, auditable domain
workflows.

### P2.1 Introduce a durable travel domain model

- [ ] Add airports with IATA codes, country, and IANA timezone.
- [ ] Separate recurring flight schedules from dated flight instances.
- [ ] Add itinerary and itinerary-leg models.
- [ ] Add typed cabin, fare, currency, booking, payment, flight, and
  notification statuses.
- [ ] Store money as integer minor units or database decimals rather than
  formatted strings.
- [ ] Add explicit traveler, ticket, and seat-assignment records.
- [ ] Plan and test migration of existing demo data.

Acceptance criteria:

- Domain rules are expressed with database constraints and typed application
  values where possible.
- Existing users and bookings migrate without silent data loss.
- Rollback and recovery steps are documented.

### P2.2 Add inventory holds

- [ ] Create expiring seat/fare holds during checkout.
- [ ] Release abandoned holds automatically.
- [ ] Convert holds atomically when booking completes.
- [ ] Display expiry and recovery behavior to the customer.

Acceptance criteria:

- Two customers cannot purchase the same seat.
- Abandoned checkout does not permanently reduce inventory.
- Hold expiry and conversion are covered by concurrency tests.

### P2.3 Integrate real payments safely

- [ ] Select a payment provider and use hosted/tokenized card components.
- [ ] Ensure the application never receives or stores raw card numbers or CVVs.
- [ ] Add authorization, capture, failure, retry, refund, and reconciliation
  states.
- [ ] Verify signed webhooks and handle duplicate/out-of-order delivery.
- [ ] Add receipts and customer-safe payment history.

Acceptance criteria:

- A booking is confirmed only after the required payment state is established.
- Webhook handling is idempotent and tested.
- No raw payment-card data appears in application state, requests, logs, or the
  database.

### P2.4 Implement cancellation, disruption, and refund rules

- [ ] Define cancellation eligibility by fare and departure time.
- [ ] Release seats without rewriting seat identifiers.
- [ ] Calculate and record refunds or credits.
- [ ] Handle airline-initiated delays and cancellations.
- [ ] Offer rebooking, refund, or credit for disrupted itineraries.
- [ ] Preserve immutable booking and status history.

Acceptance criteria:

- Cancellation and disruption changes are transactional and auditable.
- Customer, inventory, payment, and notification states remain consistent.
- End-to-end tests cover self-service and staff-assisted paths.

### P2.5 Implement check-in and travel documents

- [ ] Add check-in eligibility windows and restrictions.
- [ ] Confirm traveler/document details at check-in.
- [ ] Support seat confirmation or allowed seat changes.
- [ ] Generate a boarding pass for each eligible traveler and leg.
- [ ] Provide confirmation numbers, receipts, and resend actions.

Acceptance criteria:

- The Check-In navigation leads to a complete journey.
- Ineligible customers receive a clear reason and next step.
- Boarding passes are scoped to the authenticated booking owner.

## Phase 3: Customer experience and content

Goal: make the application clear, responsive, accessible, and dependable across
devices.

### P3.1 Repair travel-guide presentation

- [ ] Remove overlapping and duplicated city panels.
- [ ] Create a clear map/list/detail interaction model.
- [ ] Support keyboard city selection and visible focus.
- [ ] Provide meaningful empty, loading, and map-failure states.
- [ ] Make favorites and reviews update consistently.

Acceptance criteria:

- The guide works at supported desktop and mobile widths without overlap or
  inaccessible content.
- Map selection, list selection, favorites, and reviews have accessibility and
  end-to-end coverage.

### P3.2 Add responsive layouts

- [ ] Define supported breakpoints and viewport test matrix.
- [ ] Make header/navigation usable on narrow screens.
- [ ] Make booking search/results and checkout usable without horizontal
  scrolling.
- [ ] Make profile, status tables, travel guide, footer, and administration
  responsive.
- [ ] Add responsive visual-regression coverage.

Acceptance criteria:

- Core journeys pass at representative phone, tablet, and desktop viewports.
- No primary action or required information is clipped or obscured.

### P3.3 Complete the accessibility pass

- [ ] Replace emoji-only controls with labeled buttons and accessible icons.
- [ ] Add semantic headings, landmarks, and form error associations.
- [ ] Ensure full keyboard navigation and visible focus.
- [ ] Verify color contrast and non-color status indicators.
- [ ] Honor reduced-motion preferences.
- [ ] Add automated accessibility checks to CI.

Acceptance criteria:

- Core routes have no serious automated accessibility findings.
- Manual keyboard and screen-reader smoke tests are documented and pass.

### P3.4 Standardize feedback and media

- [ ] Replace `alert()` calls with consistent inline errors and notifications.
- [ ] Add optimistic behavior only where rollback is reliable.
- [ ] Replace eligible `<img>` elements with optimized image components.
- [ ] Add image dimensions, fallbacks, upload constraints, and accessible alt
  text.
- [ ] Break oversized client components into focused modules.

Acceptance criteria:

- Errors identify the failed action and provide a recovery path.
- Build and lint complete without image warnings.
- The booking and profile components have clear, testable responsibilities.

### P3.5 Make guides and notifications production-ready

- [ ] Validate, edit, report, and moderate reviews.
- [ ] Add managed guide image storage instead of unrestricted values.
- [ ] Move geocoding behind a cached, rate-limited server boundary with provider
  attribution.
- [ ] Add notification preferences and delivery channels.
- [ ] Replace static on-time analytics with real completed-flight data, or label
  it clearly as sample data.

Acceptance criteria:

- External provider failures degrade gracefully.
- Moderation and notification actions are authorized and auditable.
- Analytics labels accurately describe their source and freshness.

## Phase 4: Operations and administration

Goal: give staff safe workflows for operating schedules, flights, bookings, and
customer support.

### P4.1 Reconcile schedules and future flights

- [ ] Update eligible future instances when a schedule changes.
- [ ] Protect booked instances from silent destructive changes.
- [ ] Define safe schedule deactivation and deletion behavior.
- [ ] Show affected instances and bookings before staff confirmation.

Acceptance criteria:

- Schedule changes cannot silently orphan or invalidate bookings.
- Every bulk operation has a preview, audit record, and retry strategy.

### P4.2 Make time and status accurate

- [ ] Store schedule intent using airport-local time and IANA timezone.
- [ ] Store flight-instance timestamps as unambiguous instants.
- [ ] Display airport-local time with timezone abbreviation.
- [ ] Separate upcoming, departed, arrived, delayed, and cancelled flights.
- [ ] Replace the unqualified real-time claim unless a live data source exists.

Acceptance criteria:

- Daylight-saving transitions and cross-date international legs have tests.
- Customers can tell which timezone every displayed time uses.

### P4.3 Add staff permissions and audit history

- [ ] Replace the single ADMIN role with scoped staff permissions.
- [ ] Record actor, action, target, before/after state, reason, and timestamp.
- [ ] Require stronger authentication for privileged operations.
- [ ] Add audit-log search and retention rules.

Acceptance criteria:

- Staff can access only the operations required by their role.
- Sensitive changes can be reconstructed from immutable audit records.

### P4.4 Add customer-support workflows

- [ ] Search bookings by confirmation, customer, flight, and date.
- [ ] Resend confirmations and receipts.
- [ ] Perform authorized seat changes, cancellations, refunds, and rebooking.
- [ ] Add internal notes without exposing them to customers.
- [ ] Paginate large customer, booking, flight, and notification datasets.

Acceptance criteria:

- Support actions use the same domain services and validation as self-service
  actions.
- Staff operations are authorized, auditable, and covered by journey tests.

## Phase 5: Production readiness

Goal: operate the application safely and predictably in staging and production.

### P5.1 Add observability

- [ ] Add structured logs with request, booking, itinerary, and payment
  correlation identifiers.
- [ ] Add error tracking and customer-safe error pages.
- [ ] Track latency, error rate, booking conversion, inventory horizon, job
  failures, and payment reconciliation.
- [ ] Define actionable alerts and ownership.

Acceptance criteria:

- A failed booking can be traced across application, database, job, and payment
  boundaries without exposing sensitive data.
- Operational alerts include a documented response playbook.

### P5.2 Harden deployment and database operations

- [ ] Define development, test, staging, and production configurations.
- [ ] Add application health and readiness checks.
- [ ] Make local service ports configurable.
- [ ] Add migration checks, deployment sequencing, and rollback procedures.
- [ ] Add automated backups and perform a restore drill.
- [ ] Review indexes and query plans for production access patterns.

Acceptance criteria:

- Staging uses production-like deployment and migration paths.
- Restore objectives are documented and demonstrated.
- Deployments fail safely when dependencies are unavailable.

### P5.3 Add application and privacy controls

- [ ] Add security headers and a tested Content Security Policy.
- [ ] Restrict uploads by type, size, content, and access policy.
- [ ] Add customer data export, correction, and deletion workflows.
- [ ] Document data retention and third-party processors.
- [ ] Review authorization at every server action and API boundary.

Acceptance criteria:

- Security and privacy controls have automated regression coverage where
  possible.
- The team can answer what personal data is stored, why, where, and for how
  long.

### P5.4 Expand continuous verification

- [ ] Keep build, typecheck, lint, Jest, and Playwright checks required.
- [ ] Add dependency, secret, container, and migration scanning.
- [ ] Add accessibility and responsive visual-regression tests.
- [ ] Add performance budgets for key public routes.
- [ ] Remove debug output and test warnings.

Acceptance criteria:

- Required CI checks cover security, correctness, accessibility, and deployment
  artifacts.
- A clean verification run completes without warnings that hide real failures.

## Progress log

Add one row when work starts, becomes blocked, or completes.

| Date | Item | Status | PR | Notes |
| --- | --- | --- | --- | --- |
| 2026-07-11 | Roadmap baseline | Complete | — | Browser, source, Jest, Playwright, build, lint, and dependency audit reviewed. |
| 2026-07-11 | P0.1 | Complete | #34 | Excluded local secrets, added fail-closed runtime validation, sanitized standalone builds, scanned final image content and layers, and documented rotation. |
| 2026-07-12 | P0.2 | Complete | #35 | Upgraded Next.js, Auth, D3, Node, and ESLint; cleared the production audit; and added CI enforcement. |
| 2026-07-12 | P1.4 | In progress | #32 | Added a concurrency-safe manual occurrence generator with custom seating; scheduled background generation and horizon monitoring remain. |
| 2026-07-12 | P0.3 | Complete | #37 | Added shared Zod schemas, normalized mutation inputs, structured safe errors, and request/mutation limits. |
| 2026-07-12 | P0.4 | Complete | #38 | Made server fares and inventory authoritative, removed fake payment identifiers, and added idempotent, concurrency-tested booking persistence. |
| 2026-07-12 | P0.5 | In progress | #39 + #40 | Canonicalized email identity, added database-backed registration and login throttles, and implemented generic verified-email activation and password recovery journeys. Staff protection and passenger-data rules remain. |
| 2026-07-14 | P0.5 | In progress | #42 | Added authenticated encryption, safe customer/staff projections, automated retention deletion and key rotation, and a tested passenger-data policy. Stronger staff protection remains. |
| 2026-07-14 | P0.5 | Complete | #43 | Required TOTP for staff accounts, limited first-time enrollment sessions, encrypted authenticator secrets, replay-resistant codes, and an eight-hour staff authentication window. |
| 2026-07-14 | P1.1 | In progress | #45 | Defaulted each route to its next future operating date and covered the seeded default search journey. Date constraints, nearby dates, URL state, and service states remain. |
| 2026-07-17 | P1.1 | In progress | — | Rejected past departures and invalid return ordering in the UI and server, and excluded already-departed inventory from same-day results. Booking windows and later search slices remain. |
