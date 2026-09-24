# Vendored Airport Reference Data

This directory contains vendored snapshot datasets used to generate reference data for airports and stations.

## Sourcing & Provenance

- **Airport Codes, Names, Municipality, and Coordinates**:
  Sourced from [OurAirports](https://ourairports.com/data/), released to the **Public Domain** under [Creative Commons CC0 1.0 Universal (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/).
- **Timezone Mappings**:
  IANA Time Zone Database (tzdb) canonical identifiers determined via maintained spatial boundary datasets (`geo-tz` / `tz-lookup`).

## Design Rationale

As described in Issue #105:
- Reference data must stay seeded and offline: Customer searches, booking validations, and route scheduling cannot depend on third-party APIs being reachable at runtime.
- Sourcing is reproducible: Sourcing from an explicit snapshot ensures every modification appears as a clear, reviewable code diff.
- Code generation script enforces consistency: `scripts/generate-airports.ts` validates IATA codes and IANA timezone strings before emitting `lib/data/AirportData.ts`.

## Usage & Workflows

To regenerate `lib/data/AirportData.ts`:
```bash
npm run airports:generate
```

To verify that `lib/data/AirportData.ts` has not drifted from the vendored snapshot (suitable for CI):
```bash
npm run airports:check
```
