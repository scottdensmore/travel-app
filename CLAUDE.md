# travel-app (Mona Airways)

Next.js 16 App Router + Prisma/PostgreSQL + NextAuth. TypeScript strict, Tailwind, shadcn/ui.

## Commands

```bash
npm ci                      # Node 22 required (.npmrc engine-strict blocks other majors)
npm run dev                 # http://localhost:3000
npm run lint                # eslint app components lib
npx tsc --noEmit            # typecheck (no npm script)
npm test                    # Jest — needs a running Postgres (see Gotchas)
npx playwright test         # E2E; auto-starts the dev server
npm run build               # next build + scripts/sanitize-standalone.mjs
```

```bash
docker compose up --build         # full stack: db + mailpit + proxy, migrates and seeds
docker compose up -d db mailpit   # just the services Jest and Playwright need
npx prisma migrate deploy && npx prisma db seed
```

## Environment

`cp .env.example .env`, then generate three secrets:

- `NEXTAUTH_SECRET` — 32+ characters
- `PASSENGER_DATA_ENCRYPTION_KEYS` — `local-v1:$(openssl rand -base64 32)`
- `STAFF_MFA_ENCRYPTION_KEYS` — a *different* `local-v1:$(openssl rand -base64 32)`

`lib/env.ts` validates all eight required variables fail-closed at boot (via
`instrumentation.ts`). A malformed key ring crashes startup rather than degrading.
Local verification and recovery email lands in Mailpit at http://localhost:8025.

## Architecture

- `app/actions.ts` — `'use server'`; the primary mutation path for the whole app
- `app/api/` — auth routes only (register, verify, password reset, NextAuth)
- `lib/*Service.ts` — data and business logic, called from server actions
- `lib/validation.ts` — shared Zod schemas; mutations parse through `parseActionInput`
- `lib/actionResult.ts` — mutations return `{ ok: false, error }` instead of throwing on validation failure
- `prisma/schema.prisma` — migrations are hand-authored SQL, several security-critical

## Gotchas

- `__tests__/**/*.database.test.ts` require a live Postgres; start it before `npm test`
- Node-environment tests need `/** @jest-environment node */` (jsdom is the Jest default)
- Playwright runs `workers: 1, fullyParallel: false` on purpose — parallel runs collide on the DB
- Always `npm run build`, never bare `next build`: the sanitize step strips `.env` files from
  standalone output, and CI asserts no secret survives in any image layer
- Staff mutations gate on `hasVerifiedStaffAccess(session)` — a session alone is not enough;
  staff must complete TOTP enrollment (`docs/STAFF_ACCOUNT_POLICY.md`)
- Podman fallback: use `podman` / `podman-compose` when Docker is unavailable

## Conventions

4-space indent, single quotes, semicolons. The `@/*` path alias maps to the repo root.
Conventional Commits, subject 72 characters or fewer. Branch first — never commit to `main`.
`REAL_WORLD_ROADMAP.md` is the source of truth for hardening work; reference the item ID in
PRs and add a progress-log row on completion.

Full workflow policy (TDD, `ui-review` → `verifier` → `code-review` gates, merge rules):
see [AGENTS.md](AGENTS.md).
