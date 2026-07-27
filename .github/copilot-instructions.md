# Copilot instructions — travel-app (Mona Airways)

Next.js 16 App Router + Prisma/PostgreSQL + NextAuth. TypeScript strict, Tailwind, shadcn/ui.

## Code style

- 4-space indent, single quotes, semicolons.
- Import from the repo root via the `@/*` alias (`@/lib/prisma`, not `../../lib/prisma`).
- Chart and other browser-interactive components need `'use client'` at the top of the file.

## Where code goes

- Mutations are server actions in `app/actions.ts` (`'use server'`), not REST endpoints.
  `app/api/` holds auth routes only.
- Data and business logic live in `lib/*Service.ts`, called from server actions.
- Validate every mutation input against a Zod schema from `lib/validation.ts` using
  `parseActionInput`. Return `actionValidationFailure(...)` rather than throwing on
  invalid input; see `lib/actionResult.ts`.
- Staff-only mutations must gate on `hasVerifiedStaffAccess(session)`. A valid session
  alone is not sufficient — staff must have completed TOTP enrollment.

## Testing

- Jest + Testing Library for unit and component tests in `__tests__/`; Playwright for
  browser journeys in `e2e/`.
- Tests that touch the database need `/** @jest-environment node */` and a running
  Postgres (`docker compose up -d db mailpit`).
- Add coverage for new behavior before implementing it.

## Tracking work

Record progress in `REAL_WORLD_ROADMAP.md` — reference the roadmap item ID in the PR and
add a progress-log row when an item completes. Update `README.md` only when setup steps
or user-facing features actually change.

Full workflow policy (TDD, review gates, commit and merge rules) is in
[AGENTS.md](../AGENTS.md).
