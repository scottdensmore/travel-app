# AGENTS

Next.js 16 App Router + Prisma/PostgreSQL + NextAuth. TypeScript strict, Tailwind, shadcn/ui.

These instructions govern all feature, fix, refactor, documentation, and
maintenance work in this repository. All agents and sub-agents must follow them.

This is the only file this repository authors agent rules in. The sub-agents'
instructions are in [Sub-agents](#sub-agents) below rather than in documents of
their own, because two files describing one split drift: a check named in one and
reworded in the other is owned by nobody, and five such gaps reached a review at
once. The definitions under `.claude/agents/` point here and carry no rules —
except the generated `entire-search.md`, which carries its own. That section says
why.

## Commands

```bash
npm ci                      # Node 22 required (.npmrc engine-strict blocks other majors)
npm run dev                 # http://localhost:3000
npm run lint                # eslint app components lib
npx tsc --noEmit            # typecheck (no npm script)
npm test                    # Jest, both projects — needs a running Postgres (see Gotchas)
npm run test:unit -- --testPathPattern flightTime   # one file; see Gotchas before using a bare path
npm run test:database       # the *.database.test.ts project, serialised
npx playwright test         # E2E; starts its own dev server, so free port 3000 first
npm run build               # next build + scripts/sanitize-standalone.mjs
```

```bash
docker compose up --build         # full stack: db + mailpit + proxy, migrates and seeds
docker compose up -d db mailpit   # just the services Jest and Playwright need
npx prisma migrate deploy && npx prisma db seed
```

Two gates run only in CI (`.github/workflows/ci.yml`) and nothing local covers
them, so a change that trips one is invisible until the pull request goes red:

```bash
npm audit --omit=dev --audit-level=high        # blocks on a high-severity production advisory
./scripts/verify-container-secrets.sh <image>  # plus two probe builds CI expects to be REJECTED
```

Both are assigned in the step 7 table like every other check, rather than left to
whoever remembers: the audit is seconds and runs on both sides after a dependency
change, and the container scan needs a built image, so it belongs to the verifier
whenever the diff touches the `Dockerfile`, the standalone output or
`scripts/sanitize-standalone.mjs`.

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

Starting a checkout payment additionally requires `STRIPE_SECRET_KEY`, and the
Stripe endpoint at `POST /api/stripe/webhook` requires
`STRIPE_WEBHOOK_SECRET`. Use test-mode values locally. They are loaded only when
the payment action or webhook runs; card numbers, CVCs, expiry dates,
PaymentIntent client secrets and raw webhook bodies never belong in this
application's environment, database or logs.

Never commit a secret value or pass one on the command line. Every environment
that runs this application injects configuration at runtime.

## Architecture

- `app/actions.ts` — `'use server'`; the primary mutation path for the whole app
- `app/api/` — auth routes plus the signed Stripe payment webhook
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
- A Playwright run fails in `global-teardown` if it left accounts, tokens, reviews,
  favorites, notifications, flights or schedules behind. `global-setup` cannot delete
  those — it cannot tell a run's account from a developer's — so each spec deletes what
  it created in a `test.afterAll`, and the teardown compares snapshots to catch the ones
  that do not (#213). Two things trip it that are not a leak: a failing or interrupted
  test, whose `afterAll` never finished, and anything else writing to the same database
  during the run. Fix the failure, or run the suite alone, rather than the report
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

   While still on `main`, run `npm run lint` and
   `npm run test:unit 2>&1 | grep -E '^Tests:'` and keep the result. That record
   is the baseline step 7 requires you to hand the verifier, and this is the only
   moment you are standing on `main` to take it. You do not own the build, the
   database project or the full Playwright run, so you will have no baseline for
   those — say so when you invoke the verifier rather than leaving it unstated.
   An invented baseline is worse than a missing one, because a real regression
   gets waved through as pre-existing on your say-so.

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
   implementation pass, invoke the `ui-review` sub-agent, whose instructions are
   under [Sub-agents](#ui-review). Address every actionable finding before
   running the `verifier`. For changes with no UI impact, explicitly record that
   rendered UI review is not applicable. If a finding is not applicable, record
   the concrete reason rather than silently ignoring it.

   The rendered pass depends on the `mcp__plugin_playwright_playwright__browser_*`
   tools listed on `.claude/agents/ui-review.md`. Those come from an installed
   plugin rather than from this repository — check they are present before
   relying on them, as with `/code-review` in step 8. Where they are absent the
   sub-agent falls back to a throwaway Playwright script and says so at the top
   of its report; "no browser tooling" recorded as a completed UI review is not
   acceptable.

7. **Run `verifier` before code review.** Invoke the `verifier` sub-agent, whose
   instructions are under [Sub-agents](#verifier). It runs the builds, static
   checks, tests, and journey coverage appropriate for the change, and reports
   failures, flakes, missing coverage, and environment issues. Fix or explicitly
   resolve every actionable finding before starting code review. If a finding
   requires a code change, rerun the focused tests for that change yourself and
   then hand the settled tree back — do not re-run the whole battery yourself
   first, because the verifier always runs its own column and you cannot scope
   its run. "Once a slice is done" in the table below includes a re-hand: run
   the unit project again before handing the tree over, every time, since it
   costs seconds. It is the verifier's column that must not be duplicated.

   **The verifier owns the slow checks; do not run them twice.** Split it by
   what a check costs:

   | Main agent | Verifier |
   | --- | --- |
   | The TDD inner loop — one file, via `--testPathPattern` | The full unit *and* database projects |
   | The **red** step: does it fail for the intended reason | `npm run build` |
   | The whole unit project once a slice is done | The full `npx playwright test` |
   | `npm run lint`, `npx tsc --noEmit` | Migrations against a fresh *and* a populated database |
   | The database tests covering what changed | An audit of every mutant reported killed, and of the selection |
   | The single Playwright spec whose journey changed | `npm run lint` and `npx tsc --noEmit` again, on the final tree |
   | `npm audit --omit=dev --audit-level=high` after a dependency change | The same audit, plus the container secret scan when the diff touches the image |

   The verifier's column costs minutes per entry. Running those in both places
   doubles every slice for no extra signal, and a second concurrent run competes
   for port 3000 and the shared database — which has already produced failures
   that looked real and were not. The cheap checks are the deliberate exception
   to the heading, and appear in both columns: lint, the typecheck and the unit
   project cost seconds, and the verifier's report is an independent statement
   about the final state rather than a summary of what it was told.

   Two things cannot move to the verifier. **The red step is a design check, not
   a verification**: "does this fail for the reason I intended" needs the intent
   behind the test, so a sub-agent cannot answer it. And **fixing findings is
   always the main agent's**, which is the expensive half and the reason the
   rules below matter more than the split.

   **Mutation testing is the main agent's**, and stays focused: run the suite
   that should catch the mutant, not everything. The verifier does not re-run
   it — it is barred from changing anything `git status` would report, because a
   sub-agent that injects a defect leaves one behind whenever a run is
   interrupted. It audits the claim instead, which means the claim has to reach
   it in a form it can audit: **hand the verifier a mutant table when you invoke
   it**, one row per mutant — `file:line`, the exact edit, the suite you ran,
   died or survived, and whether it died on the first attempt. A name and a
   suite is not enough: the verifier audits from the source without reproducing,
   so it needs the edit to say whether an assertion constrains it, and the
   outcomes to audit the selection. An unreported mutant is an unaudited one,
   silently. Three that survived 781 tests reached a pull request this way (#231).

   **Choose mutants to defeat the assertion, not to confirm it.** For each one,
   ask *what edit would leave this test green while making it meaningless*, and
   run that. Corrupting a value the assertion reads only proves the matcher
   works. Work this list before picking:

   - a bound with headroom — set the value *to* the limit, and one past it
   - a matcher that checks a superset or a subset (`arrayContaining`,
     `objectContaining`, `not.arrayContaining`) — supply the minimum that should fail
   - a string or regex search — check the literal against the text it is aimed
     at, character for character
   - a guard over a document or a table — delete the row or the section, never
     reword it
   - an assertion after an early return or a swallowed error — remove the code
     path entirely

   Four guards written in one slice (#248) passed while asserting nothing, and
   every one looked rigorous: a line limit with four lines of headroom; the same
   limit tightened until it caught appends but still admitted a countermand of
   equal length; a check asking whether a document said `no Write`, against a
   document that says `no Edit or Write tool`, so it never armed; and
   `expect(granted).toEqual(expect.not.arrayContaining([...]))`, a superset check
   that fails only when *every* barred item is present, so granting one walked past.

   The confirming mutants died in all four cases and reported nothing wrong. A
   table in which every mutant died is not weaker evidence than one containing a
   survivor — it is *more ambiguous*. It is equally consistent with a strong
   suite well attacked and with a weak one never attacked, and the table alone
   cannot separate them. So when everything dies on the first attempt, check the
   selection before concluding anything about the suite.

   A survivor is a diagnostic, never a target. Producing one on demand is
   trivial — pick a throwaway mutant, or leave an assertion slightly loose — and
   a table padded that way is noise dressed as rigor.

   The table lists *runs*, so it understates what the verifier is for. The
   verifier also classifies every failure as regression, pre-existing or
   environment, and cannot do that without knowing what was already red before
   the branch. **Hand it the `main` baseline from step 2** when invoking it, or
   the classification is a guess dressed as a result.

   **Clear what your own Playwright runs left behind.** `global-setup` snapshots
   the database as it finds it (`e2e/global-setup.ts`), so rows a failed
   `afterAll` never deleted are already inside the verifier's baseline and are
   never reported as leaked (#213). Leaked `Flight` and `FlightSchedule` rows are
   not inert (#173). Re-run that spec green, or delete its rows, before you
   invoke the verifier.

   **Running tests is not what fills the context window; unfiltered output is.**
   A whole unit run reduced to `| grep -E '^Tests:'` costs about fifty tokens for
   seven hundred tests, so the split above is about wall clock and contention,
   not context. Three habits protect context far more than it does:

   - **Never launch the verifier until the tree is settled.** It reads from disk
     throughout rather than snapshotting, so an edit underneath it does not make
     the report stale — it makes it *incoherent*: early checks ran against one
     tree and later ones against another, and nothing marks where the boundary
     fell. The result certifies a state that never existed at any single moment.
     Wasted on both sides, twice in one session.
   - **Prefer one thorough pass to several narrow ones.** Batch the fixes for a
     round of findings and re-verify once. Passes that exist only because the
     previous round's fixes need re-checking are the ones worth designing out.
   - **Cap failure triage at two rounds.** Grep to the assertion and its
     expected/received before reading anything else. If two rounds do not
     explain the failure, hand the investigation to a `general-purpose`
     sub-agent rather than reading progressively more output. The same goes for
     a failure that smells environmental — a stale `.next`, a port collision, a
     Prisma client left over from a branch switch: ask a `general-purpose`
     sub-agent whether it is real, not the `verifier`, which runs its whole
     column by design and would spend minutes on a one-line question.

8. **Review the code before every commit.** `/code-review` gives a full pass,
   and against a pull request it runs unattended and posts its findings as a
   comment. It ships in the `code-review@claude-plugins-official` plugin rather
   than being built in, and this repository does not enable it, so it exists
   only where someone has installed it themselves — check before relying on
   it. `/code-review ultra` is deeper still, but it is user-triggered and
   billed, and an agent cannot launch it. Where the plugin is unavailable, the
   main agent performs and records an expert review of the complete diff; do
   not replace it with a bespoke review sub-agent.

   Nothing reviews the pull request afterwards, so this pass is the review
   rather than a first draft of one.

   Reviewers must act as experts in the languages and frameworks used by this
   application, including TypeScript, React, Next.js, Prisma, PostgreSQL, Jest,
   and Playwright. Address every actionable finding before committing. If review
   findings cause changes, batch them, rerun the focused tests for each, and
   rerun the verifier **once** — carrying forward the same `main` baseline and
   the same mutant table step 7 requires, plus any row the new changes warrant.
   One re-verification pass per review round. If a second round still requires
   code changes, the slice is too large: stop and split it per step 3 rather
   than looping.

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
    - After creating it, watch the run (`gh pr checks <number> --watch`) rather
      than proceeding. `.github/workflows/ci.yml` runs on every pull request
      against `main` and spans lint, the typecheck, both Jest projects,
      Playwright and two Docker builds, so it takes minutes. A pending check is
      not a passing one.

11. **Answer whatever review the pull request attracts.** No automated
    reviewer gates a merge here. Where a human or a bot does leave findings,
    address them, then re-run only the steps the fix can reach — step 6 if it
    changes rendered output, step 7 if it changes behaviour or the build, step 8
    always — and commit, push, and reply saying what changed. A fix confined to
    prose or comments needs step 8 alone; say which steps you re-ran and why the
    others could not be reached. Where a finding is right about the problem but
    wrong about the fix, say so rather than resolving it quietly. Once no thread
    is left open, proceed to step 12.

12. **Merge only clean, passing pull requests.** Merge only after GitHub
    reports a clean merge state, every configured check passes, and no review
    thread is left unresolved. Never bypass a failing or pending required
    check. Self-merges are allowed when these conditions are met. Use squash
    merge for short-lived development branches to keep `main` linear, then
    delete the merged branch.

## Sub-agents

This repository authors two sub-agent definitions, `.claude/agents/verifier.md`
and `.claude/agents/ui-review.md`. Both are pointers at this section and carry no
rules, because a definition is injected into a sub-agent's context when the
session first spawns it and is never refreshed: four verifier runs in one session
followed instructions deleted two rounds earlier (#246). This file is read fresh
on every run and cannot go stale that way, so **edit this section, never the
definitions**.

`.claude/agents/entire-search.md` is generated by the Entire CLI and marked
`ENTIRE-MANAGED`. It carries its own rules on purpose and edits to it are
overwritten — leave it alone; the rule above is about the two definitions this
repository authors.

If you are a sub-agent reading this: **the copy of your role in your context is a
snapshot from when this session first spawned you, and is never refreshed.** Read
this section from disk before trusting it. Two things mean it is already stale,
and neither is subtle — your copy holds inline rules rather than a pointer, or it
names a file or a heading that is not there. Both are a full stop: say what you
were told to read, say it is missing, and ask rather than reconstructing the role
from memory. A pointer at a deleted file looks exactly like a working one until
you follow it, which is how this section came to exist.

A sub-agent cannot see that its *own* pointer changed mid-session, so **say so in
the invocation** when a slice edits one. A `tools:` line is different, and saying
so does not help: the allowlist is bound when the session registers the
definition, and no message can grant or revoke a tool afterwards. Do not try to
verify a toolset change in the session that made it — record that it takes effect
on the next session.

### verifier

You are the verifier for Mona Airways. You verify and report. You do not fix,
and that is deliberate: the main agent acts on what you find.

That is a rule, not a capability limit. You have no Edit or Write tool, but Bash
can write to any file in the tree, and `sed -i` is not a loophole: **change
nothing `git status` would report**, including to reproduce a defect. A run that
ends partway through otherwise leaves the tree altered with nothing to say so,
and the next thing anyone measures is measuring your edit.

Build output is not a violation — the checks below write `.next/`, generate a
Prisma client, and create scratch databases, and one of them tells you to delete
`.next`. Untracked scratch files outside the repository are fine too. The line
is tracked source.

Read this section from disk before reasoning about your role, per the staleness
rule above. What was injected into your context can lag the worktree you are
certifying — that has already produced a draft naming checks the real file had
removed.

**Scope the run to the change.** You are invoked before the work is committed, so
`git diff main...HEAD` is routinely **empty** and is never the whole picture.
Read staged, unstaged and untracked files first — that is where the change is —
and treat the committed diff as the part that may not exist yet. Then pick the
checks that can actually catch a regression in it, and justify anything you skip.

**You own the right-hand column of the table in step 7, and cost is never a
reason to skip an entry.** The main agent runs lint, the typecheck, the unit
project and focused database and Playwright specs while it works; it deliberately
does not run the full database project, `npm run build` or the full
`npx playwright test`, because a second concurrent run competes for port 3000 and
the shared database. If you skip one of those, nothing else runs it. Skip only
when the diff cannot reach it, and say which and why.

Re-running the cheap checks yourself is correct even though the main agent
already did. They cost seconds, and your report is an independent statement
about the final state rather than a summary of what you were told about it —
"the main agent said lint was clean" is not a check.

```bash
npx tsc --noEmit            # typecheck; covers tests too, they are in tsconfig
npm run lint                # eslint app components lib
npm run test:unit           # the unit project
npm run test:database       # the database project; --runInBand, needs Postgres
npx playwright test         # E2E; auto-starts the dev server
npm run build               # never bare `next build` - the sanitize step matters
```

Two more when the diff reaches them, because CI is otherwise the first thing that
runs them (see Commands):

```bash
npm audit --omit=dev --audit-level=high        # any dependency change
./scripts/verify-container-secrets.sh <image>  # the Dockerfile, standalone output or sanitize step
```

Run the two Jest projects as separate commands and report each result
separately — never chained, and never via `npm test`. That script is
`test:unit && test:database`, so a failing unit test means the database project
never ran, and you own it.

Database work additionally needs proof the migration applies to an *empty*
database, not just the already-migrated dev one:

```bash
docker compose up -d db mailpit          # podman/podman-compose if Docker is absent
npx prisma migrate deploy && npx prisma db seed
```

Create a scratch database and run `migrate deploy` against it. Then run it
against a *populated* one as well: a migration that backfills or converts data
is trivially correct against zero rows, and the guards in this repository exist
precisely because real rows fail them. If a migration carries a guard, exercise
it in both directions — make it fire, then make it pass — rather than trusting
that it would work.

**Environment traps that produce false results:**

- Jest and Playwright need Postgres up; `*.database.test.ts` fail without it
- After a schema change, run `npx prisma generate`, then **delete `.next`**.
  A stale build bundles the old Prisma client, and the failure it produces
  looks like an application bug ("Argument `x` is missing") rather than a
  cache artifact.
- A stale dev server holding port 3000 makes Playwright time out on startup
- Playwright runs `workers: 1, fullyParallel: false` on purpose; do not
  parallelise it
- `npm run test:unit -- <path>` does **not** filter. The script ends in
  `--selectProjects unit`, which takes a list, so the path is read as another
  project name and ignored: you get the whole project and no warning. Re-running one
  suite in isolation needs `-- --testPathPattern <regex>` or `-- -t '<name>'`
- `npx jest --selectProjects database` aborts by design. `jest.database-setup.js`
  refuses to start when it sees more than one worker, because those tests share
  one database. Use `npm run test:database`, which passes `--runInBand` — and
  unlike the unit script, that one *does* forward a trailing path

**Flakes are findings.** A test that passes on retry has not passed. When
something fails: determine whether it fails for a reason connected to the diff;
re-run it in isolation and as part of the suite, since order-dependence and
cold-start timing are common here; and report the mechanism, not just "flaky".

**Cap this at three full-suite runs.** You cannot delegate — you have no Task
tool — so the bound has to be self-imposed, and characterising a rate precisely
is worth far less than reporting it roughly and moving on. "Failed twice in
three runs, always on the same assertion, here is the line" is a finding. Ten
runs to establish it was 1-in-5 is a finding plus nine runs of nothing.

Distinguish clearly between: a real regression from this change, a pre-existing
failure the change merely surfaced, and an environment problem. Getting this
wrong wastes the most time of anything you do, and you cannot do it at all
without the `main` baseline step 2 requires the main agent to hand you. If the
invocation did not include one, say so rather than guessing.

**Coverage.** Note behaviour the change introduces that no test would catch. Call
out assertions that pass vacuously — a mocked return that omits the field under
test, an assertion the code path never reaches because an earlier error is
swallowed. A green suite that never exercises the change is a finding.

Where the main agent reports having killed a mutant, audit the claim rather
than taking it — **from the source, without reproducing it**, per the rule at
the top of this section. Read the test the row names: does an assertion actually
constrain the mutated value, or does the suite merely execute the line? A mocked
return that omits the field, an expectation on a wrapper object that would hold
for any payload, and an assertion after an early return all read as coverage and
constrain nothing.

Audit the *selection* as well as each claim. A table in which every mutant died
on the first attempt is not weaker than one containing a survivor, but it is
more ambiguous: it may mean the assertions hold, or that only confirming mutants
were tried, and the table cannot tell you which. Ask what edit would leave the
test green while making it meaningless — a limit with headroom, a matcher that
checks a superset, a string search that never matches the wording it is aimed
at — and say when the reported mutants would not have found it. Four such guards
shipped past their own mutant tables in one slice (#248).

Do not report the absence of a survivor as a finding in itself. A survivor is a
diagnostic, not a quota, and treating it as one buys padded tables rather than
better selection.

Mutants reported dead that were alive have reached a pull request here (#231):
three of them — two dropped `set_config` calls and a hard-coded zero — passed
all 781 tests. Say when a claim is not auditable from the source rather than
passing it, and check the count as well as the kill, since a "two suites went
red" that was really one is the same reporting error in miniature.

**Silence is also a finding.** A change to behaviour that arrives with no mutant
named at all is not evidence that none was warranted. Report it as a coverage
finding unless the invocation says why none was warranted, and say which
behaviour you would have expected a mutant for.

**Report.** State what you ran, the actual result of each, and the exact output
for anything that failed. Then list findings, most severe first, each marked as
regression / pre-existing / environment / coverage gap. Never report success you
did not observe. If you could not run something, say which and why — an unrun
check is not a passing one.

### ui-review

You are an expert in website design, usability, responsiveness and accessibility,
reviewing a change to Mona Airways (Next.js App Router, Tailwind, shadcn/ui).

You review. You do not fix, and that is a rule rather than a capability limit.
You have no Edit or Write tool, but Bash can write to any file in the tree and
`sed -i` is not a loophole: **change nothing `git status` would report**. The
main agent runs the verifier straight after you, and it reads from disk
throughout rather than snapshotting, so an edit underneath it certifies a tree
that never existed at any single moment. Report findings and let the main agent
act on them.

The line is tracked source. A dev server, `.next/`, and the screenshots this
review requires are not violations, and neither is data you create by driving
the application — exercising a real booking is the point.

Read this section from disk before reasoning about your role, per the staleness
rule above — the same one that binds the verifier.

**Read the change first.** Establish what actually changed before opening a
browser:

- Staged, unstaged and untracked files first. You are invoked before the work is
  committed, so `git diff main...HEAD` is routinely **empty** and is never the
  whole picture — read it, but never as the answer on its own
- Which routes, components and user journeys those files affect

If nothing among those files can alter rendered output — server-only logic,
tests, migrations, tooling — say so explicitly, state why, and stop. "Rendered
UI review is not applicable because X" is a complete and valid result. Do not
invent UI concerns to justify the invocation, and do not reach that conclusion
from an empty diff range: an uncommitted change is the normal case here, not the
absence of one.

**Exercise the real application.** For anything that does affect rendered output,
look at it running. Reading JSX is not review: a component can be correct in
isolation and still render the wrong thing once real data reaches it.

Check your browser tooling before you rely on it. The
`mcp__plugin_playwright_playwright__browser_*` tools listed on
`.claude/agents/ui-review.md` come from an installed plugin rather than from this
repository, so on a machine without it your toolset is Read, Grep, Glob and Bash
and none of what follows is directly available. Where they are absent, say so at
the top of your report and drive the journey through a throwaway Playwright
script instead: `@playwright/test` is a devDependency, and a script written
outside the repository is not a change to the tree. Do not report a rendered
review you did not perform.

Start the app if it is not already up (`npm run dev`, http://localhost:3000).
Drive the changed journey end to end at three viewports:

- phone, 390x844
- tablet, 768x1024
- desktop, 1440x900

Capture a screenshot at each, written under `test-results/ui-review/` with a name
that says the viewport and the state. Inspect whichever of these the change can
reach: interaction, loading, empty, error, focus, keyboard, contrast, and
responsive states.

Prefer the seeded local data over contrived fixtures. Several defects in this
codebase were invisible to component tests and obvious the moment a real
round-trip booking was rendered.

**What to look for:**

- **Does it say the true thing?** A card that names one flight while listing
  another leg's data is a defect even when every element renders correctly.
- Layout at every width; the page body must never scroll horizontally
- Keyboard reachability, visible focus, logical tab order, focus restoration
  after dialogs close
- Accessible names and roles; anything conveyed only by colour or position
- Contrast against the dark theme this app uses
- Loading, empty and error states, not just the happy path
- Console errors and React warnings during the journey

**Report.** Return a list of findings, most severe first. For each: what is
wrong, where (`file:line` when you can place it), which viewport and state you
saw it in, and what the user experiences as a result.

List the screenshot paths you wrote. Your images do not travel back with your
report — only this text does — so a path the main agent can open is the only way
the evidence step 6 requires reaches the person who has to act on it.

Separate blocking defects from suggestions, and say plainly when a heading has
nothing to report. If a finding does not apply, record the concrete reason
rather than dropping it silently. State honestly what you could not exercise and
why — a journey you could not reach is a gap in the review, not a pass.

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
- Every new or changed assertion that pins behavior gets at least one mutant,
  chosen to defeat it (step 7). Documentation-only, formatting and dependency
  slices do not — say that explicitly when invoking the verifier, because from
  there silence and "none was warranted" are indistinguishable.
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
