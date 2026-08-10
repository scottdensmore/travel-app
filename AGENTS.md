# travel-app (Mona Airways)

Next.js 16 App Router + Prisma/PostgreSQL + NextAuth. TypeScript strict, Tailwind, shadcn/ui.

These instructions govern all feature, fix, refactor, documentation, and
maintenance work in this repository. All agents and sub-agents must follow them.

## Commands

```bash
npm ci                      # Node 22 required (.npmrc engine-strict blocks other majors)
npm run dev                 # http://localhost:3000
npm run lint                # eslint app components lib
npx tsc --noEmit            # typecheck (no npm script)
npm test                    # Jest, both projects — needs a running Postgres (see Gotchas)
npm run test:unit           # the parallel project; takes flags, e.g. -- -t 'name'
npm run test:database       # the *.database.test.ts project, serialised
npx playwright test         # E2E; starts its own dev server, so free port 3000 first
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

`.env.example` also carries `DATABASE_IS_DISPOSABLE=true`. A Playwright run and the
database Jest project delete every booking in the database they are pointed at, and
refuse to start without it — host and name cannot tell a developer's database from a
deployment, since Compose gives the application the same pair. Never set it where
this application is deployed.

Local verification and recovery email lands in Mailpit at http://localhost:8025.

Never commit a secret value or pass one on the command line. Every environment
that runs this application injects configuration at runtime.

## Architecture

- `app/actions.ts` — `'use server'`; the primary mutation path for the whole app
- `app/api/` — auth routes only (register, verify, password reset, NextAuth)
- `lib/*Service.ts` — data and business logic, called from server actions
- `lib/validation.ts` — shared Zod schemas; mutations parse through `parseActionInput`
- `lib/actionResult.ts` — mutations return `{ ok: false, error }` instead of throwing on validation failure
- `prisma/schema.prisma` — migrations are hand-authored SQL, several security-critical

## Gotchas

- A migration that fails leaves Prisma refusing to apply anything else: the next
  `migrate deploy` reports `P3009`, not the original error. Fix the data the migration
  objected to, then `npx prisma migrate resolve --rolled-back <migration_name>` before
  deploying again. A failed migration rolls back whole — no half-created type or
  column survives — so the retry is clean. Several migrations here `RAISE EXCEPTION`
  deliberately rather than let a cast fail with a less useful message, so this is a
  normal path rather than a disaster
- There are no down migrations. Rolling one back means reversing its SQL by hand and
  deleting its row from `_prisma_migrations`; write the reversal in the migration's
  header comment when it is not obvious
- `__tests__/**/*.database.test.ts` require a live Postgres; start it before `npm test`
- Those files run serially in their own Jest project: they share one database and
  several assert against whole tables, so running them beside each other counted one
  file's fixtures in another file's scan (#155). `npm test` runs the unit project
  first and stops if it fails, so pass flags to `test:unit`/`test:database` directly
  rather than to `npm test`, which does not forward them. What serialises them is
  `--runInBand` in the `test:database` script, not the config, so the project's
  `globalSetup` refuses any run it is not given — `npx jest --selectProjects
  database` stops with a message naming the worker count rather than
  reproducing the interference the split removed (#215)
- Node-environment tests need `/** @jest-environment node */` (jsdom is the Jest default)
- Playwright runs `workers: 1, fullyParallel: false` on purpose — parallel runs collide on the DB
- Always `npm run build`, never bare `next build`: the sanitize step strips `.env` files from
  standalone output, and CI asserts no secret survives in any image layer
- Staff mutations gate on `hasVerifiedStaffAccess(session)` — a session alone is not enough;
  staff must complete TOTP enrollment (`docs/STAFF_ACCOUNT_POLICY.md`)

## Code Style

4-space indent, single quotes, semicolons. The `@/*` path alias maps to the repo root.
Chart and other browser-interactive components need `'use client'`.

## Development Workflow

1. **Inspect before changing anything.** Inspect the repository, current Git
   state, and all applicable instruction files before making changes. Preserve
   unrelated staged, unstaged, and untracked work.

2. **Create a branch first.** Create a dedicated feature, fix, refactor, chore,
   test, or documentation branch before making code changes. Never commit
   directly to `main`, and create the branch from the latest appropriate
   `main` state.

3. **Choose a thin vertical slice.** Before implementing a tracked issue or
   feature, define the smallest end-to-end slice that can be reviewed, tested,
   shipped, and merged independently. Prefer one coherent user-visible or
   operational outcome over a broad horizontal layer. If the next issue is too
   large for one pull request, split it into ordered slices and complete only
   the current slice. Keep pull requests small enough for thorough review,
   reliable verification, and quick rollback. When work surfaces a defect or
   improvement that belongs outside the current slice, do not widen the slice
   to absorb it — file it as described under Issue Tracking and carry on.

4. **Use test-driven development when behavior or structure is testable.**
   - Add or update a focused test before implementation.
   - Run it and confirm it fails for the expected reason.
   - Implement the smallest appropriate change.
   - Run focused tests while iterating.
   - Refactor only while the relevant tests remain green.

5. **Inspect the complete diff.** Review the branch diff plus all staged,
   unstaged, and untracked files. Remove accidental or unrelated changes while
   preserving work that belongs to the user.

6. **Run `ui-review` before verification.** After the main agent completes an
   implementation pass, invoke the `ui-review` sub-agent. The `ui-review`
   sub-agent must act as an expert in website design, usability,
   responsiveness, and accessibility. Address every actionable finding before
   running the `verifier`. For UI-affecting changes, exercise the changed
   journey in the rendered application at representative phone, tablet, and
   desktop viewports; inspect interaction, loading, empty, error, focus,
   keyboard, contrast, and responsive states as applicable; and capture
   screenshots or equivalent visual evidence. For changes with no UI impact,
   explicitly record that rendered UI review is not applicable. If a finding
   is not applicable, record the concrete reason rather than silently ignoring
   it.

7. **Run `verifier` before code review.** Invoke the `verifier` sub-agent to run
   the builds, static checks, tests, and journey coverage appropriate for the
   change. The verifier must report failures, flakes, missing coverage, and
   environment issues. Fix or explicitly resolve every actionable finding
   before starting code review. If a verifier finding requires a code change,
   rerun the verifier after addressing it.

8. **Review the code before every commit.** Two mechanisms cover this, and
   neither is a bespoke sub-agent:
   - The `PreToolUse` hooks in `.claude/settings.json` review the diff
     automatically and block on `git push` and `gh pr create`. They run
     without being asked; do not work around a block by pushing differently.
   - `/code-review` gives a fuller pass, and against a pull request it runs
     unattended and posts its findings as a comment. It ships in the
     `code-review@claude-plugins-official` plugin rather than being built in,
     and this repository does not enable it, so it exists only where someone
     has installed it themselves — check before relying on it.
     `/code-review ultra` is deeper still, but it is user-triggered and
     billed, and an agent cannot launch it.

   Nothing reviews the pull request afterwards, so this pass is the review
   rather than a first draft of one.

   Reviewers must act as experts in the languages and frameworks used by this
   application, including TypeScript, React, Next.js, Prisma, PostgreSQL, Jest,
   and Playwright. Address every actionable finding before committing. If review
   findings cause changes, rerun the appropriate tests and the `verifier`, then
   obtain fresh review approval for the changed state.

9. **Commit after approval.** Commit only after verification and code review
   are complete. Use Conventional Commits:

   ```text
   <type>(<scope>): <imperative summary>
   ```

   Keep the subject at 72 characters or fewer, describe why in the body when
   useful, and do not combine unrelated work.

10. **Create pull requests from the reviewed state.**
    - Confirm that local verification remains valid.
    - Rerun code review only if the reviewed state changed after the pre-commit
      review.
    - A changed state includes code, tests, documentation, generated files,
      conflict resolution, or any other staged, unstaged, or untracked content.
    - Do not repeat code review when the already-reviewed diff and worktree
      remain unchanged.
    - Push and create the pull request only after local verification and any
      required code review are complete.
    - Open a normal, ready-for-review pull request by default. Do not open draft
      pull requests unless the user explicitly asks for a draft.

11. **Answer whatever review the pull request attracts.** No automated
    reviewer gates a merge here. Where a human or a bot does leave findings,
    address them, re-run steps 6 to 9 for whatever changed, push, and reply
    saying what changed — and where a finding is right about the problem but
    wrong about the fix, say so rather than resolving it quietly.

12. **Merge only clean, passing pull requests.** Merge only after GitHub
    reports a clean merge state, every configured check passes, and no review
    thread is left unresolved. Never bypass a failing or pending required
    check. Self-merges are allowed when these conditions are met. Use squash
    merge for short-lived development branches to keep `main` linear, then
    delete the merged branch.

## Testing Expectations

- Preserve all existing tests and add coverage for new behavior and
  regressions.
- Add functional coverage for complete user journeys when a change crosses
  component, server, database, or authentication boundaries.
- Use Jest and Testing Library for focused unit/component/integration tests and
  Playwright for browser journeys.
- Mock true external boundaries in focused tests; use realistic local services
  for end-to-end verification where appropriate.
- Treat warnings, flakes, skipped checks, and environment failures as findings
  that require an explicit resolution.

## Issue Tracking

- GitHub issues labelled `roadmap` are the source of truth for product
  hardening work. The `Phase 1` through `Phase 5` milestones carry the priority
  order; work phases in order unless a later item is an explicit prerequisite
  for current work.
- Reference the issue number in the pull request. When a pull request delivers
  only part of an issue, comment with the number and what remains rather than
  closing it.
- **File anything found but not fixed.** When work surfaces a defect, risk, or
  improvement outside the current slice, open a GitHub issue for it before
  moving on. A finding recorded only in a commit message, a pull request
  comment, or a chat reply is a finding that gets lost. Search open issues
  first and comment on the existing one instead of opening a duplicate.
- An issue filed this way states where the problem is (file and line), what
  was observed, and why it matters. Say whether it was verified against
  running code or is a reading of the source that still needs confirming.
  Apply `roadmap` only when it is product-hardening work belonging to a phase.
- Filing is not a substitute for finishing the current slice. If the finding
  makes the slice wrong or unsafe to ship, say so and stop instead of filing
  around it.

## Containerization Fallback

- Docker and Docker Compose are preferred when available.
- If Docker or Docker Compose is unavailable or fails because this machine uses
  Podman, fall back to `podman` and `podman-compose` respectively.
