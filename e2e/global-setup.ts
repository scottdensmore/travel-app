import { loadEnvConfig } from '@next/env';
import type { FullConfig } from '@playwright/test';
import { prisma } from '../lib/prisma';

/**
 * The dev server compiles a route the first time something asks for it, and
 * `app/api/auth/[...nextauth]` is expensive enough to cost more than the default
 * budget of the assertion that waits for a sign-in to land. Whichever test signs
 * in first against a server that has not compiled it yet pays that bill and can
 * fail on it (#121).
 *
 * The symptom moves around, which is what made it look like cross-spec
 * interference: what matters is whether the server being used has already
 * compiled the route, not which test or how many are running. `reuseExistingServer`
 * means a re-run against a still-warm server passes, so re-running a failure
 * "proves" nothing.
 *
 * Paying it here puts the cost outside every test's budget.
 */
async function warmAuthRoutes(baseURL: string): Promise<void> {
  const deadline = Date.now() + 30_000;

  // Playwright starts the web server before this runs, so one attempt is
  // normally enough; the loop only covers a server still finishing its boot.
  while (Date.now() < deadline) {
    try {
      // One GET of the NextAuth handler compiles the whole route module, which
      // is what the sign-in POST would otherwise wait for. The login page is
      // warmed too because every sign-in starts by loading it.
      const responses = await Promise.all([
        fetch(`${baseURL}/login`),
        fetch(`${baseURL}/api/auth/csrf`),
      ]);
      // Drain the bodies rather than leaving sockets open for the whole run.
      await Promise.all(responses.map(response => response.arrayBuffer()));
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Not fatal: the suite still works, it just goes back to paying the compile
  // inside whichever test signs in first. Say so loudly, because the failure
  // that follows will look like an unrelated flake.
  console.warn(
    `[global-setup] ${baseURL} was unreachable for 30s; auth routes were not warmed. `
    + 'Expect the first sign-in to be slow and possibly flaky (#121).'
  );
}

/**
 * Everything a previous run booked.
 *
 * The suite books seat 11A on a seeded flight, and nothing removed it, so the
 * seat map rendered 11A as taken and three specs failed on that database from
 * then on -- permanently, until somebody reseeded by hand. CI never saw it
 * because CI seeds a fresh database every time; a developer's database rotted
 * after one run (#173).
 *
 * `Booking` is the only delete needed: `Passenger`, `ItineraryLeg` and
 * `SeatAssignment` all cascade from it, and a held seat is what the next run
 * needs back.
 *
 * Deliberately not `User`, and deliberately not `Notification`: the seed
 * creates neither, so every row belongs either to a previous run or to whoever
 * is developing here, and this cannot tell them apart. Leftover accounts and
 * notifications are harmless -- the specs mint fresh emails and assert against
 * their own rows -- while deleting someone's manual test login is not.
 *
 * The trade this does make, and it is a real one: a booking made by hand in the
 * development database goes too, and it goes before the specs run rather than
 * after, so it is gone quietly. Nothing here can tell that booking from the
 * one a previous run left holding 11A.
 */
/**
 * Hosts a suite is allowed to destroy data on.
 *
 * `localhost` is a developer's machine and CI's service container; `db` is the
 * Compose service. Anything else is somebody's real database.
 */
const DISPOSABLE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

/**
 * The environment stating, of itself, that its data is expendable.
 *
 * Host and name cannot carry this. `db/travel_app` is what `docker-compose.yml`
 * gives the *application*, so a checkout pointed at a running deployment --
 * or at its published Postgres port -- looks exactly like a developer's own
 * database. The difference is not in the address; it is in whether whoever set
 * that environment up considers the contents disposable.
 *
 * So it has to be said, in the environment rather than on the command line: a
 * flag on the invocation is set by whoever runs the tests, and the question is
 * about the database, not about them. `.env.example` and CI set it; nothing
 * that deploys this application does.
 */
const DISPOSABLE_MARKER = 'DATABASE_IS_DISPOSABLE';

/**
 * Database names this suite owns.
 *
 * A host on its own is not identity: `postgresql://…@localhost/production` is
 * local, and so is a production database reached through an SSH tunnel or a
 * proxy. The name has to say what it is.
 *
 * `travel_app` is the only name the repository configures -- `.env.example`,
 * `docker-compose.yml` and CI all use it. Anything else has to be named
 * `*_test`, or added here deliberately where the addition is reviewed.
 */
const DISPOSABLE_DATABASES = new Set(['travel_app']);
const DISPOSABLE_DATABASE_PATTERN = /_test$/;

/**
 * Refuse to delete anything on a database this suite does not own.
 *
 * The deletion below is unqualified by design -- it has to be, since it cannot
 * tell a previous run's booking from any other. That makes a misaimed
 * `DATABASE_URL` catastrophic and silent: point it at staging, run `npm test`
 * or `npx playwright test`, and every booking is gone with nothing asked and
 * nothing recoverable.
 *
 * So the check is on the destination rather than on intent, and it fails closed:
 * an unparseable or absent URL stops the run too.
 */
function assertDisposableDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Refusing to clear bookings: DATABASE_URL is not set.');
  }

  if (process.env[DISPOSABLE_MARKER] !== 'true') {
    throw new Error(
      `Refusing to clear bookings: ${DISPOSABLE_MARKER} is not set to "true" in this `
      + 'environment. This suite deletes every booking in the database it is pointed at, '
      + `so the environment has to say the data is expendable. Add ${DISPOSABLE_MARKER}=true `
      + 'to the .env you use for development and testing -- and never to one that deploys '
      + 'this application.'
    );
  }

  let host: string;
  let name: string;
  try {
    const parsed = new URL(databaseUrl);
    // Node returns the IPv6 literal with its brackets, which would never match
    // a bare `::1`.
    host = parsed.hostname.replace(/^\[|\]$/g, '');
    name = parsed.pathname.replace(/^\//, '');
  } catch {
    throw new Error('Refusing to clear bookings: DATABASE_URL is not a URL this can check.');
  }

  if (!DISPOSABLE_HOSTS.has(host)) {
    throw new Error(
      `Refusing to clear bookings: DATABASE_URL points at host "${host}", which is not one `
      + `this suite may destroy data on (${[...DISPOSABLE_HOSTS].join(', ')}). `
      + 'Point DATABASE_URL at a local or Compose database before running the tests.'
    );
  }

  // Being local is not the same as being disposable. A tunnel or a proxy puts
  // any database on localhost, so the name has to identify it too.
  if (!DISPOSABLE_DATABASES.has(name) && !DISPOSABLE_DATABASE_PATTERN.test(name)) {
    throw new Error(
      `Refusing to clear bookings: DATABASE_URL names database "${name}", which this suite `
      + `does not own. Expected ${[...DISPOSABLE_DATABASES].join(', ')} or a name ending in `
      + '"_test". Being reachable on localhost is not enough -- a tunnel or a proxy puts a '
      + 'real database there too.'
    );
  }
}

export async function clearPreviousRunBookings(): Promise<void> {
  assertDisposableDatabase();

  await prisma.booking.deleteMany();
}

async function globalSetup(config: FullConfig): Promise<void> {
  loadEnvConfig(process.cwd());

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  await warmAuthRoutes(baseURL);

  await clearPreviousRunBookings();

  // Last, so that nothing this file asked for can leave a counted attempt
  // behind for the first test to trip over.
  await prisma.authRateLimit.deleteMany();
  await prisma.$disconnect();
}

export default globalSetup;
