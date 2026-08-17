import { prisma } from '../../lib/prisma';

/**
 * What the database held at a moment, as one list of row identifiers per table.
 *
 * `global-setup` deliberately does not delete accounts, because it cannot tell a
 * run's account from a developer's (#173). Two snapshots can: whatever is
 * present at the end and absent at the start appeared while the run had the
 * database to itself, and Playwright runs `workers: 1` against a server it
 * started, so that window belongs to the suite.
 */
export type RowSnapshot = Record<string, string[]>;

/**
 * A row, named so that whoever reads the failure knows which spec to open.
 *
 * The primary key alone does not: a leaked `Review` is a cuid, and a cuid says
 * nothing. Every spec mints its account from a prefix it owns
 * (`guidetest-`, `notiftest-`, `login-test-`), so the owning email is the
 * identifying part -- kept beside the key rather than instead of it, because
 * the key is what makes the row unique and the comparison exact.
 */
const owned = (id: string, email: string | null) => `${id} (${email ?? 'no email'})`;

/**
 * Tables a spec is expected to leave as it found them.
 *
 * `Booking` is absent on purpose -- `global-setup` clears every booking before
 * each run, so one left behind is corrected rather than accumulated, and the
 * seat it held comes back (#173). `Passenger`, `ItineraryLeg`,
 * `SeatAssignment` and `BookingStatusChange` cascade from it, `Account` and
 * `Session` cascade from `User`
 * (and stay empty anyway, since sessions are JWTs), `AuthRateLimit` is cleared
 * at both ends of a run, and `Airport` and `CityGuide` are seed reference data
 * no spec writes. Nothing clears the tables below, so a row left in one is
 * permanent.
 *
 * `Review` and `UserFavorite` cascade from `User`, so a spec that deletes its
 * account is already clean; they are tracked because a review written by an
 * account that outlives the run would not be.
 *
 * `Flight` and `FlightSchedule` are here for the same reason and a sharper one:
 * `admin.spec.ts` and `booking-authority.spec.ts` create them, and a leaked
 * flight is not inert -- it turns up in search results and in the status board,
 * which is the corrosion #173 was.
 *
 * Note when measuring by hand that `VerificationToken` also *shrinks* on its
 * own: issuing one prunes expired ones (`lib/authTokens.ts`). A count that fell
 * is not a leak, and nothing here reads it as one.
 *
 * What identifies a row is the whole label, which scopes this to rows that
 * appeared: a run that *deletes* something it did not create passes, and a spec
 * that renamed a tracked row mid-run would read as one leak plus one silent
 * disappearance. No spec does either -- nothing writes `flightNumber` or
 * `email` after creation -- and #213 is an additive problem. Worth knowing
 * before adding a rename journey.
 */
const TRACKED: Array<{ table: string; ids: () => Promise<string[]> }> = [
  {
    table: 'User',
    ids: async () =>
      (await prisma.user.findMany({ select: { id: true, email: true } }))
        .map(row => owned(row.id, row.email)),
  },
  {
    // Payment attempts survive account deletion so provider reconciliation is
    // not erased with a profile. That also means a spec has to clean up the
    // attempt itself; deleting its test user is not sufficient.
    table: 'PaymentAttempt',
    ids: async () =>
      (await prisma.paymentAttempt.findMany({
        select: { id: true, checkoutId: true, user: { select: { email: true } } },
      })).map(row => owned(row.id, row.user?.email ?? `checkout ${row.checkoutId}`)),
  },
  {
    // Webhook deliveries cascade from their attempt, but an event can be added
    // to an attempt that existed before the run. Track it independently so
    // that delivery history cannot accumulate invisibly across E2E runs.
    table: 'PaymentWebhookEvent',
    ids: async () =>
      (await prisma.paymentWebhookEvent.findMany({
        select: {
          id: true,
          providerIntentId: true,
          paymentAttempt: { select: { user: { select: { email: true } } } },
        },
      })).map(row => owned(
        row.id,
        row.paymentAttempt.user?.email ?? `intent ${row.providerIntentId}`,
      )),
  },
  {
    table: 'PaymentRefund',
    ids: async () =>
      (await prisma.paymentRefund.findMany({
        select: {
          id: true,
          bookingStatusChange: { select: { booking: { select: { user: { select: { email: true } } } } } },
        },
      })).map(row => owned(
        row.id,
        row.bookingStatusChange.booking.user?.email ?? 'deleted booking owner',
      )),
  },
  {
    table: 'PaymentRefundAttempt',
    ids: async () =>
      (await prisma.paymentRefundAttempt.findMany({
        select: {
          id: true,
          paymentRefund: {
            select: {
              bookingStatusChange: {
                select: { booking: { select: { user: { select: { email: true } } } } },
              },
            },
          },
        },
      })).map(row => owned(
        row.id,
        row.paymentRefund.bookingStatusChange.booking.user?.email ?? 'deleted booking owner',
      )),
  },
  {
    table: 'VerificationToken',
    ids: async () =>
      (await prisma.verificationToken.findMany({ select: { identifier: true } }))
        .map(row => row.identifier),
  },
  {
    table: 'Review',
    ids: async () =>
      (await prisma.review.findMany({ select: { id: true, user: { select: { email: true } } } }))
        .map(row => owned(row.id, row.user.email)),
  },
  {
    table: 'UserFavorite',
    ids: async () =>
      (await prisma.userFavorite.findMany({
        select: { id: true, user: { select: { email: true } } },
      })).map(row => owned(row.id, row.user.email)),
  },
  {
    table: 'Notification',
    ids: async () =>
      (await prisma.notification.findMany({
        select: { id: true, user: { select: { email: true } } },
      })).map(row => owned(row.id, row.user.email)),
  },
  {
    table: 'Flight',
    ids: async () =>
      (await prisma.flight.findMany({ select: { id: true, flightNumber: true } }))
        .map(row => `${row.id} (${row.flightNumber})`),
  },
  {
    table: 'FlightSchedule',
    ids: async () =>
      (await prisma.flightSchedule.findMany({ select: { id: true, flightNumber: true } }))
        .map(row => `${row.id} (${row.flightNumber})`),
  },
  {
    // Audit rows cascade from their schedule, but a failed admin journey can
    // stop before deleting that schedule. Track them independently so bulk
    // changes cannot accumulate invisibly between Playwright runs (#83).
    table: 'FlightScheduleTermsChange',
    ids: async () =>
      (await prisma.flightScheduleTermsChange.findMany({
        select: {
          id: true,
          flightScheduleId: true,
          actorUser: { select: { email: true } },
        },
      })).map(row => owned(
        row.id,
        row.actorUser?.email ?? `schedule ${row.flightScheduleId}`,
      )),
  },
  {
    // A hold outlives the account that took it -- `holderKey` is not a foreign
    // key -- so deleting a run's users leaves its holds behind, greying out
    // seats for whatever runs next. That is how #74 broke two specs before
    // this table was tracked here.
    table: 'SeatHold',
    ids: async () =>
      (await prisma.seatHold.findMany({ select: { id: true, flightId: true, seatNumber: true } }))
        .map(row => `${row.id} (flight ${row.flightId} seat ${row.seatNumber})`),
  },
];

/**
 * Exported so a test can assert it covers what it claims to. A table added here
 * and nowhere else is indistinguishable from one whose lookup returns nothing.
 */
export const TRACKED_TABLES = TRACKED.map(entry => entry.table);

export async function captureRowSnapshot(): Promise<RowSnapshot> {
  const snapshot: RowSnapshot = {};
  for (const { table, ids } of TRACKED) {
    snapshot[table] = await ids();
  }
  return snapshot;
}

/**
 * Rows that were not there before the run and still are after it.
 *
 * A table missing from `before` counts every row as added rather than none: a
 * snapshot that failed to record a table should read as loud, not as clean.
 */
export function rowsAddedDuringRun(before: RowSnapshot, after: RowSnapshot): RowSnapshot {
  const added: RowSnapshot = {};
  for (const [table, ids] of Object.entries(after)) {
    const known = new Set(before[table] ?? []);
    const survivors = ids.filter(id => !known.has(id));
    if (survivors.length > 0) added[table] = survivors;
  }
  return added;
}

/** How many identifiers to name before the message stops being readable. */
const NAMED_PER_TABLE = 5;

/**
 * The report, or `null` when the run left nothing behind.
 *
 * It names rows rather than counting them, because the fix is always in one
 * spec and the identifier is what says which: the accounts this caught carried
 * their spec's own prefix.
 */
export function describeLeakedRows(added: RowSnapshot): string | null {
  const tables = Object.entries(added).filter(([, ids]) => ids.length > 0);
  if (tables.length === 0) return null;

  const detail = tables
    .map(([table, ids]) => {
      const named = ids.slice(0, NAMED_PER_TABLE).join(', ');
      const rest = ids.length > NAMED_PER_TABLE ? `, and ${ids.length - NAMED_PER_TABLE} more` : '';
      return `  ${table} (${ids.length}): ${named}${rest}`;
    })
    .join('\n');

  return (
    'This run left rows behind in a database that nothing else clears:\n'
    + `${detail}\n`
    + 'Every spec deletes the rows it creates, in a `test.afterAll`, so that a '
    + 'development database does not drift from a fresh one (#213). Add the cleanup '
    + 'to the spec that created these -- the email beside each row carries its prefix.\n'
    + 'If a test failed or the run was interrupted, its `afterAll` may not have '
    + 'finished, and fixing that failure is what clears this.'
  );
}
