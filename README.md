# Mona Airways

Mona Airways is a full-stack airline booking application built with Next.js 16,
Prisma, PostgreSQL, NextAuth, Tailwind CSS, and shadcn/ui. It is a demonstration
application, not a production airline service.

## What the application supports

- One-way and round-trip flight search with shareable search URLs, live
  inventory, nearby-date suggestions, cabin-aware fares, sorting, and filters.
- Authenticated checkout with server-authoritative pricing, per-leg seat
  selection, encrypted passenger identity data, and duplicate-booking
  protection.
- Customer booking management, including itinerary review, seat changes,
  cancellation, points activity, and flight notifications.
- Account registration, email verification, sign-in throttling, password reset,
  and recovery email through Mailpit locally or Postmark in deployments.
- Travel guides with maps, favorites, and customer reviews.
- Staff administration for flight schedules, generated flight inventory,
  status updates, passenger manifests, users, and travel guides. Staff access
  requires TOTP enrollment and verification.

Product hardening work and known gaps are tracked in
[GitHub issues labelled `roadmap`](https://github.com/scottdensmore/travel-app/issues?q=is%3Aissue%20label%3Aroadmap).

## Prerequisites

- Node.js 22. The repository enforces this major through `package.json` and
  `.npmrc`.
- npm.
- Docker with Docker Compose for the recommended local stack. Podman and
  podman-compose can be used as a fallback.

The repository includes both `mise.toml` and `.nvmrc`. With mise activated,
entering the repository selects Node 22 automatically after:

```bash
mise install
node --version
```

The nvm equivalent is:

```bash
nvm install
nvm use
```

## Local setup

Copy the local environment template:

```bash
cp .env.example .env
```

Before starting the application, edit `.env` and populate three independent
secrets:

- `NEXTAUTH_SECRET`: a cryptographically random value at least 32 characters
  long.
- `PASSENGER_DATA_ENCRYPTION_KEYS`: `local-v1:<base64-key>`, where the key is
  32 random bytes generated with `openssl rand -base64 32`.
- `STAFF_MFA_ENCRYPTION_KEYS`: the same format, using a different random key.

Never commit `.env` or reuse its local values in a deployment.

Install the locked dependencies:

```bash
npm ci
```

### Full Compose stack

The recommended command starts PostgreSQL, Mailpit, the reverse proxy, the app,
and the inventory scheduler. It also applies migrations and seeds the database:

```bash
docker compose up --build
```

The app is available at [http://localhost:3000](http://localhost:3000), and
verification and recovery messages appear in Mailpit at
[http://localhost:8025](http://localhost:8025). Mailpit binds to loopback and is
only for local development.

### App process on the host

To run Next.js on the host while keeping its backing services in Compose:

```bash
docker compose up -d db mailpit
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

The seed command creates the reference data and flight inventory needed by
search. Deployments that do not run the Compose scheduler must invoke
`npm run inventory:generate` on their own schedule and monitor
`npm run inventory:check`.

## Verification

The standard checks are:

```bash
npm run lint
npx tsc --noEmit
npm test
npx playwright test
npm run build
```

PostgreSQL and Mailpit must be running for the full Jest and Playwright suites.
Use `npm run build`, not a bare `next build`; the npm script also removes local
environment files from the standalone output.

The database Jest project and Playwright setup delete every booking in their
configured database. They refuse to run unless `DATABASE_IS_DISPOSABLE=true`.
The supplied `.env.example` enables that guard for local development only;
never set it in a deployed environment or against data that must be retained.

## Repository guide

- `app/actions.ts`: primary server mutation entry point.
- `app/api/`: authentication routes.
- `lib/*Service.ts`: business and data-access services.
- `lib/validation.ts`: shared Zod validation schemas.
- `prisma/schema.prisma` and `prisma/migrations/`: database model and
  hand-authored migrations.
- `e2e/` and `__tests__/`: browser, unit, integration, and database coverage.
- `AGENTS.md`: contributor and automated-agent workflow.

## Security and operational policy

- [Security policy and vulnerability reporting](SECURITY.md)
- [Passenger identity data policy](docs/PASSENGER_DATA_POLICY.md)
- [Staff account protection policy](docs/STAFF_ACCOUNT_POLICY.md)

Deployed environments must inject configuration at runtime, use Postmark for
transactional email, and sit behind an ingress whose forwarded-address behavior
matches `AUTH_TRUSTED_PROXY_HOPS`. See the security policy for the full contract.
