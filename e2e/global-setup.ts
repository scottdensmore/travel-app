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

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('Refusing to clear bookings: DATABASE_URL is not a URL this can check.');
  }

  if (!DISPOSABLE_HOSTS.has(host)) {
    throw new Error(
      `Refusing to clear bookings: DATABASE_URL points at "${host}", which is not a `
      + `database this suite is allowed to destroy data on `
      + `(${[...DISPOSABLE_HOSTS].join(', ')}). `
      + 'Point DATABASE_URL at a local or Compose database before running the tests.'
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
