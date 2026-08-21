# AGENTS

## Project overview

Mona Airways is a full-stack airline booking demonstration built with Next.js 16
App Router, React 18, strict TypeScript, Tailwind/shadcn UI, NextAuth, Prisma 5,
and PostgreSQL 15. The base branch is `main`.

These instructions govern feature, fix, refactor, documentation, and maintenance
work in this repository. Generated skills and subagent definitions live under
`.agents/`, `.claude/`, `.codex/`, `.cursor/`, and `.github/`; project-specific
criteria belong here instead of being duplicated in those generated files.

### UI Domain

Responsive web application. User-visible changes must be exercised at phone,
tablet, and desktop widths, including keyboard, focus, loading, empty, and error
states reachable through the changed journey.

## Repo Map

| Area | Location and ownership |
|---|---|
| Routes and rendering | `app/`; `app/layout.tsx` is the root layout and `app/page.tsx` is the landing route |
| Server mutations | `app/actions.ts` (`'use server'`) |
| HTTP boundaries | `app/api/` for NextAuth/account routes and the signed Stripe webhook |
| Reusable UI | `components/`; interactive browser components declare `'use client'` |
| Business and data logic | `lib/`, primarily `lib/*Service.ts` and focused policy modules |
| Database contract | `prisma/schema.prisma`, hand-authored SQL in `prisma/migrations/`, and `prisma/seed.ts` |
| Unit and integration tests | `__tests__/`; database tests end in `.database.test.ts` or `.database.test.tsx` |
| Browser journeys | `e2e/*.spec.ts`; shared setup, teardown, and helpers also live under `e2e/` |
| Operational code | `Dockerfile`, `docker-compose.yml`, `deploy/`, and `scripts/` |

Generated artifacts must not be hand-edited: `lib/generated/prisma/` is produced
by `npx prisma generate`; `.next/`, `next-env.d.ts`, and `*.tsbuildinfo` are build
outputs; `prisma/migrations/migration_lock.toml` explicitly forbids manual edits.
`node_modules/` is third-party content installed from `package-lock.json`.

## Development Commands

All commands run from the repository root. CI's complete gate is declared in
`.github/workflows/ci.yml`; a command is green only when it exits 0.

| Purpose | Command | Passing evidence and limits |
|---|---|---|
| Locked install | `npm ci` | Exits 0 under Node 22; `.npmrc` rejects other majors |
| Development server | `npm run dev` | Serves `http://localhost:3000`; not a verification gate |
| Lint | `npm run lint` | ESLint covers `app/`, `components/`, and `lib/` only |
| Typecheck | `npx tsc --noEmit` | TypeScript exits 0; `tsconfig.json` includes repository `*.ts`/`*.tsx` files |
| Focused unit test | `npm run test:unit -- --testPathPattern <regex>` or `npm run test:unit -- -t '<name>'` | Jest prints a passing `Tests:` summary; a bare path does not filter |
| Unit project | `npm run test:unit` | Jest's `unit` project exits 0 |
| Database project | `npm run test:database` | Jest's `database` project exits 0 serially; PostgreSQL is required |
| Both Jest projects | `npm test` | Runs unit first, then database; a unit failure means database never ran |
| Browser journeys | `npx playwright test` | Chromium suite exits 0 and global teardown reports no leaked rows; port 3000 must be free |
| Production build | `npm run build` | Next build and the standalone sanitizer exit 0; never use bare `next build` |
| Generate inventory | `npm run inventory:generate` | Idempotently extends scheduled inventory; operational command, not a CI gate |
| Check inventory | `npm run inventory:check` | Exits nonzero when configured inventory coverage is short; operational command, not a CI gate |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | No high-severity production advisory |
| Container secret gate | `docker build --tag travel-app:ci .` then `./scripts/verify-container-secrets.sh travel-app:ci` | Scanner exits 0; CI also requires two deliberately contaminated probe images to be rejected |

For the database-backed gates, start local services with
`docker compose up -d db mailpit`, then apply and seed with
`npx prisma migrate deploy` and `npx prisma db seed`. `docker compose up --build`
starts the full app, proxy, scheduler, database, and Mailpit stack.

## Local Setup

Node 22 is required by `package.json` and `.npmrc`. Run `npm ci`, copy
`.env.example` to `.env`, then generate three independent local secrets:

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

Starting a checkout payment additionally requires matching test-mode
`STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` values, and the Stripe endpoint
at `POST /api/stripe/webhook` requires `STRIPE_WEBHOOK_SECRET`. They are loaded
only when the payment action or webhook runs. The publishable key and
PaymentIntent client secret may configure Stripe's browser library, but card
numbers, CVCs and expiry dates stay inside Stripe's hosted fields; none of those
values, client secrets or raw webhook bodies belong in this application's
environment, database or logs.

Never commit a secret value or pass one on the command line. Every environment
that runs this application injects configuration at runtime. Docker and Docker
Compose are preferred; use Podman and podman-compose when Docker is unavailable.

## Architecture & Conventions

- `app/actions.ts` is the primary mutation boundary. Mutations parse untrusted
  input through `parseActionInput` and shared Zod schemas in `lib/validation.ts`.
- Put data access and business rules in `lib/*Service.ts` or focused `lib/`
  policy modules; server actions and route handlers orchestrate those modules.
- Validation failures use the `ActionResult` contract from `lib/actionResult.ts`
  (`{ ok: false, error }`) where the action contract supports it.
- Staff mutations gate on `hasVerifiedStaffAccess(session)`: an authenticated
  session alone is insufficient until TOTP enrollment and verification complete.
- Prisma migrations are hand-authored SQL. Preserve security guards, append-only
  audit contracts, and migration recovery comments when changing them.
- Use 4-space indentation, single quotes, and semicolons. `@/*` maps to the
  repository root. Browser-interactive components require `'use client'`.

## Gotchas & Troubleshooting

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
- `npm test` is `test:unit && test:database`. A failing unit test means the database
  project never ran at all — not that it passed. Run it separately before concluding
  anything about it
- `npm run test:unit -- <path>` does **not** filter: it runs all of them and says nothing.
  The script ends in `--selectProjects unit`, which takes a list, so the path is read as
  another project name and ignored. Filter with `-- --testPathPattern <regex>` or
  `-- -t '<test name>'`. `npm run test:database -- <path>` does filter, because
  `--runInBand` sits between the project list and the path — which is exactly why the
  difference is easy to miss
- Node-environment tests need `/** @jest-environment node */` (jsdom is the Jest default)
- Playwright runs `workers: 1, fullyParallel: false` on purpose — parallel runs collide on the DB
- Playwright sets `reuseExistingServer: false`; stop any process on port 3000
  before running it. Borrowing an existing server can test stale code, so a port
  collision is an environment failure, not permission to reuse that process.
- Playwright's app server sets `E2E_STRIPE_MODE=playwright`, which replaces only
  Stripe's external server/browser boundary so booking journeys remain
  deterministic without account secrets or automated card entry. The adapter
  refuses production and any database not marked disposable; browser journeys
  cross it through `e2e/helpers/checkoutPayment.ts`
- A Playwright run fails in `global-teardown` if it left accounts, tokens, reviews,
  favorites, notifications, flights or schedules behind. `global-setup` cannot delete
  those — it cannot tell a run's account from a developer's — so each spec deletes what
  it created in a `test.afterAll`, and the teardown compares snapshots to catch the ones
  that do not (#213). Two things trip it that are not a leak: a failing or interrupted
  test, whose `afterAll` never finished, and anything else writing to the same database
  during the run. Fix the failure, or run the suite alone, rather than the report
- Always `npm run build`, never bare `next build`: the sanitize step strips `.env` files from
  standalone output, and CI asserts no secret survives in any image layer
- After a Prisma schema change, run `npx prisma generate` and remove stale
  `.next/` output before diagnosing an old-client build error.

## Testing Expectations

- **Tests are written against product code only** — code or assets that ship, or
  that produce what ships. `prisma/schema.prisma` generates the client,
  `app/globals.css` reaches the browser and `app/favicon.ico` is served, so all
  three qualify. `package.json`, `.dockerignore`, `.github/workflows/`, the
  agent instruction files, and CI tooling do not. A test whose subject is the
  repository rather than the product does not get written, and an existing one
  is removed as it is found, even when the property it pins is real and
  otherwise unguarded — open an issue for the now-unguarded property before
  removing it, and name that issue in the pull request. A guard removed with
  only a note in the diff is a guard removed silently.

  **Subject, not technique.** "It executes real code" is not the criterion — a
  shell script in `scripts/` is real code and only some of it ships — and
  neither is "it scans the source tree". A recursive scan of `app`, `components`
  and `lib` has product code as its subject and qualifies; reading
  `package.json` does not, however it is written.
- **One exception: the harness that decides whether a run is trustworthy.**
  `e2e/global-setup.ts`, the leak snapshotter, `jest.database-setup.js` and the
  configuration that wires them are test tooling and ship nothing, but a silent
  failure in any of them invalidates every other test rather than failing
  honestly — which is how three specs leaked data for months (#213), how a
  parallel database run counted another file's fixtures (#155, #215), and how a
  stale server made a healthy branch look broken (#196). Those are testable and
  tested, in `__tests__/harness/` and `__tests__/e2e/`. The exception is narrow:
  it covers the machinery that decides whether a **Jest or Playwright run** can
  be believed. A CI check whose silent failure would let something ship —
  `scripts/verify-container-secrets.sh`, `scripts/scan-image-layers.sh` — sits
  outside it, because a green CI job is not a test result. Guard those by making
  the job a required check, not by testing them from here.
- Preserve every existing test except the ones the two rules above exclude, and
  add coverage for new behavior and regressions.
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

## Verification Map

The complete gate is the CI sequence in `.github/workflows/ci.yml`. After that
gate has passed once on the state entering review, use this map to select only
the commands a subsequent fix could have invalidated.

| A fix touches | Rerun |
|---|---|
| `app/`, `components/`, or `lib/` | `npm run lint`, `npx tsc --noEmit`, affected Jest project(s), `npm run build`; add `npx playwright test` when a browser journey can change |
| `types/`, `instrumentation.ts`, or another source `*.ts`/`*.tsx` outside the lint roots | `npx tsc --noEmit`, affected Jest project(s), `npm run build`; add Playwright when the runtime journey can change |
| `__tests__/**`, `jest.config.js`, `jest.setup.js`, or `jest.database-setup.js` | `npx tsc --noEmit` and the affected Jest project; run both projects when shared Jest configuration changes |
| `e2e/**` or `playwright.config.ts` | `npx tsc --noEmit` and `npx playwright test` |
| `prisma/schema.prisma` | `npx prisma generate`, both Jest projects, `npx playwright test`, and `npm run build`; delete stale `.next/` first |
| `prisma/migrations/**` or `prisma/seed.ts` | Apply migrations to fresh and populated disposable databases, run `npm run test:database`, `npx playwright test`, and `npm run build` |
| `package.json` or `package-lock.json` | `npm ci`, `npm audit --omit=dev --audit-level=high`, then the complete gate |
| `eslint.config.mjs` | `npm run lint` |
| `tsconfig.json`, `next.config.*`, or Next/Jest/Babel configuration | `npx tsc --noEmit`, both Jest projects, `npx playwright test`, and `npm run build` |
| `Dockerfile`, `.dockerignore`, standalone sanitization, container entrypoint, or secret-scan scripts | `npm run build`, build the production image, and run `./scripts/verify-container-secrets.sh <image>` plus CI's two rejected probes |
| `.github/workflows/ci.yml` | Re-run every local command represented by the changed job; CI remains the only proof of GitHub runner and probe behavior |
| `AGENTS.md` or generated skill/subagent files | Re-run adoption with `python3 scripts/adopt.py --dry-run --keep-existing <repo>` from the `agent-skills` repository; no product test treats repository instructions as its subject |
| Anything else | The complete gate |

<!-- agent-skills:begin workflow 185672e4 — managed block, edits here are overwritten -->
## Development Workflow

Follow these stages in order (governed by the global `agent-workflow-skills`). Scale the pipeline to the
size of the change using the triage table — skipping a stage is a decision to
state out loud, never a shortcut taken silently. A stage in parentheses applies
only when its own entry says it does.

| Track | When | Stages |
|---|---|---|
| **Trivial** | Docs, comments, typos, config with no logic change | 1 → 6 → 9 |
| **Single fix** | One bug or small change with a clear, contained cause | 1 → 2 → 5 → 6 → (7) → 8 → 9 |
| **Feature** | New behavior, several files, or an architectural choice | All stages; repeat 5–8 per slice |

**Division of labor.** The main agent runs only focused checks — the single test
it just wrote, a formatter over the files it just touched. Whole suites, builds,
dependency audits, and repository-wide lint go to the **`verifier`** subagent;
reviews go to **`code-reviewer`** and **`ui-reviewer`**. Each follows the skill
of the same job (`verifier`, `code-review`, `ui-review`), reads this file for
what the project's commands and criteria are, and is declared without
file-editing tools — a read-only sandbox where the host supports one. This is
not ceremony: it keeps routine command output out of the implementation context,
and it means each gate is read by something that has not already convinced
itself the change is correct. If a subagent is unavailable, run the stage
inline against the same skill and say that you did.

**Stages end.** Every delegated stage returns a verdict, and a verdict is acted
on once. Fix what came back, then rerun only the stage whose inputs your fix
touched. If the same finding survives two attempts, stop and report it with what
you tried — do not loop. Never rerun a stage against a state it has already
seen; an unchanged tree yields an unchanged verdict.

**Preserve what you did not change.** A worktree may hold work that is not yours.
Never stage, revert, or "clean up" a change you did not make; when something
unrelated is in the way, name it and leave it alone.

**Claim only what you observed.** A gate licenses a statement about exactly
what it measured and nothing more: a green build says the code compiles, not
that the feature works; a passing test says that test passed, not that the bug
is gone. If you did not run it, say you did not. "I believe this fixes it" is a
usable sentence; "fixed and verified" without a command and its output is not.

**Say what you assumed.** When a choice would change what gets delivered and the
request does not settle it, ask before building rather than after. When it is
too small to be worth asking, decide, and write the assumption where a reviewer
will see it. An assumption nobody can see is indistinguishable from a mistake.

**Instructions are part of the change.** When a command, a behavior, or a
constraint changes, the file that documents it changes in the same commit —
`AGENTS.md`, the Verification Map, the README, whichever is now wrong. Stale
instructions are worse than missing ones, because the next agent follows them
confidently.

1. **Inspect & Branch**: Inspect `git status`, the current branch, and every
   applicable instruction file before touching anything. Note unrelated staged,
   unstaged, and untracked work so you can preserve it. Fetch the base branch
   (`git fetch origin main`) and create a dedicated branch:
   `git checkout -b <owner>/<type>/<short-description> origin/main`.
   `<owner>` is your GitHub login (`gh api user --jq .login`); `<type>` is one of
   `feat`, `fix`, `refactor`, `chore`, `test`, `docs`. Never commit to `main`.
2. **Plan & Slice (`plan-and-prototype`)**:
   - **Read before you plan.** Open the code the change will touch, its tests, and
     its call sites. A plan written without reading them is a guess about a
     codebase rather than a plan for this one.
   - Formulate a clear step-by-step plan before writing code. Define the smallest
     end-to-end slice that can be reviewed, tested, and shipped independently; if
     the work is too large for one pull request, order the slices and complete only
     the current one.
   - **A slice is vertical, not horizontal.** It goes through every layer of one
     narrow thing and ends in something you can actually verify: "add the new field
     end to end, with tests" is a slice; "rename the field everywhere" is a sweep.
     One concern per branch — if a change spans unrelated concerns, that is two
     branches.
   - **A new dependency is an architectural decision, not an implementation
     detail.** Say what it replaces, why writing that yourself is the worse option,
     and what its license and maintenance status are. Adding one silently is how a
     project acquires a liability nobody chose.
3. **Prototype Options (if needed)**: When facing architectural choices, unfamiliar
   APIs, or UX alternatives, spike lightweight prototypes and compare trade-offs
   before committing to an approach.
4. **Track Bugs & Follow-ups**: When bugs, edge cases, technical debt, or follow-up
   tasks surface mid-change, file them immediately (`gh issue create`, the project's
   tracker, or `ISSUES.md` when none is configured) instead of expanding the current
   slice.
5. **Test-Driven Development (`tdd-workflow`)**:
   - Write/update a focused test first → confirm it fails for the expected reason →
     minimal implementation → iterate until passing → refactor. A test that passes
     before the code exists is testing the wrong thing.
   - **When the change replaces an existing contract, find the tests pinning the old
     one first.** A new failing test proves the new behavior is missing; it says
     nothing about tests still asserting the behavior being removed. Search for
     assertions on the symbol, attribute, label, or role being changed and update
     them inside the same red/green loop. Skipping this is silently safe — the new
     test goes green, the loop looks complete, and the contradiction only surfaces a
     full gate cycle later.
   - **A test that has never failed is not evidence of anything.** When you add a
     regression detector, break the thing it guards and confirm it catches it, then
     put it back. A detector that cannot be shown to fire is decoration.
   - Run only the test you authored or changed, filtered by file and name. Whole
     suites are stage 6's job.
   - Pure logic (calculations, state machines, business rules) must be unit-tested.
     Non-testable areas (rendering, audio) must be visually/interactively verified.
6. **Verification (`verifier` subagent → `verifier` skill)**:
   - Run the project's full gate: lint, type-check, test suites, build. Focused runs
     from stage 5 do not substitute for it.
   - **Know what green looked like before you started.** If you do not know the
     gate passed on the state you began from, establish that first. Without it a
     failure is ambiguous — you cannot tell what you broke from what you inherited,
     and every later decision rests on that distinction.
   - **Measure the thing you ship, not a proxy for it.** A gate that checks part of
     the output, or a stand-in for it, reads exactly like one that checks all of it
     — and certifies the rest by silence. If a command covers less than it appears
     to, say what it left out.
   - The subagent runs and reports; fixing is yours. Resolve every actionable
     finding before code review. When a fix changes code, rerun the affected focused
     tests, then ask for only the gate commands whose inputs the fix touched — see
     **Verification Map** below if this project defines one. The complete gate must
     run in full at least once on the state that enters code review.
   - Some findings are environmental and no code change resolves them (browsers that
     will not install, no network, a missing credential). Resolving those means
     naming them precisely — what ran, what did not, and why — not retrying them.
7. **UI Review (`ui-reviewer` → `ui-review`)**:
   - Runs after verification, so the tree builds before anyone looks at it.
   - **Check whether this stage applies before delegating.** It applies only when
     the change can alter something a person sees or interacts with. A change
     confined to documentation, comments, configuration, build scripts, CI, tests,
     or code with no rendered output does not qualify — skip the stage, record one
     line saying which of those it was, and move on. A docs-only or test-only diff
     never needs a UI review.
   - When it does apply, audit layout, visual hierarchy, contrast (WCAG AA),
     interaction states, and accessibility according to the project's UI domain.
   - A project whose UI domain is headless or backend skips this stage every time.
   - Never invent findings to justify the stage, and never describe an appearance
     that was not observed running.
8. **Code Review (`code-reviewer` → `code-review`)**:
   - The reviewer reads the complete change: `git diff origin/main...HEAD`,
     plus staged and unstaged edits (`git diff HEAD`) and untracked files (`git
     status --porcelain`). It reports; it does not edit. **You** remove the
     accidental or unrelated edits it names, and preserve anything that is the
     user's.
   - Enforce architectural boundaries, language idioms, defensive error handling,
     and zero committed secrets.
   - Do not repeat this review on an unchanged state. Rerun it only when the
     reviewed content actually changed.
9. **Commit & PR Lifecycle (`slice-and-pr`)**:
   - **Close the loop against the request.** Re-read what was actually asked for,
     and state how this change satisfies it — and what it deliberately does not.
     Every gate above proves the code works; none of them prove it is the thing
     that was wanted. A green pipeline on the wrong feature is the most expensive
     outcome available.
   - Commit using Conventional Commits (`<type>(<scope>): <summary>`). Stage files
     explicitly; never `git add -A` when unrelated work is present.
   - **Match the stopping point to the request.** A request that only asks to
     commit stops after the local commit. A request that asks to use, follow, or
     complete the workflow—including "commit based on the workflow"—includes the
     reversible remote steps: push the branch, open the PR, and watch its checks.
     It does not authorize a merge or any action named under **Stop there and
     report**.
   - Open the PR with `gh pr create` and watch CI with `gh pr checks --watch`.
   - **The description carries the evidence.** Say why the change exists, what it
     changes grouped by concern rather than by file, and how it was tested — the
     command you actually ran and its actual result. "Should work" is not a test
     result. If a test was added, say what it would have caught.
   - **Stop there and report.** Anything you cannot take back needs explicit
     approval from the user in the current conversation: merging (`gh pr merge`),
     force-pushing, rewriting shared history, deleting a branch or tag, dropping
     or migrating data, removing files wholesale, and publishing or deploying.
     Approval for one of them is not approval for the next.
   - **Squash, unless this project says otherwise.** One reviewed slice lands as
     one commit on the base branch. The false starts, the fixups and the "address
     review" commits are how the work got made, not what it is; keeping them turns
     the base branch's history into a diary and makes a revert an archaeology
     exercise. Because the PR description is what survives, it has to carry the
     reasoning — see above. A project that requires merge commits or a rebase says
     so in its own section, and that wins.
   - **A merge takes its branch with it.** Once a merge is approved and done,
     delete that branch — remote and local, in the same step. It is the one
     deletion the merge approval covers, because it is the merge finishing rather
     than a separate act; no other branch is included. A merged branch left
     behind is a decoy: it looks like work in flight, and the next person cannot
     tell it from the real thing without checking.
   - Verify before deleting, and be aware of the squash case: a squash merge
     writes a new commit rather than joining histories, so git sees no ancestry
     and `git branch -d` refuses a branch whose every line is already merged.
     Confirm with `git diff <base> <branch>` — empty output means nothing is
     lost — and then `-D` is correct rather than reckless. If that diff is *not*
     empty, stop: something did not make it in.
<!-- agent-skills:end workflow -->
