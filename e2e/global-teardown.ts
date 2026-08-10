import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/prisma';
import { readRunBaseline } from './helpers/runBaseline';
import { captureRowSnapshot, describeLeakedRows, rowsAddedDuringRun } from './helpers/rowSnapshot';

/**
 * Fail a run that left accounts behind.
 *
 * `travelguide.spec.ts` had no cleanup at all and `auth.spec.ts` created two
 * accounts per run and deleted neither, so 67 accounts, 25 reviews and 25
 * favorites had accumulated; `auth-abuse.spec.ts` left a verification token
 * each time. Every run passed throughout, which is the point: nothing was
 * watching, so the database drifted from a fresh one until something would
 * eventually fail for a reason nobody would connect to it (#213, and #173
 * before it).
 *
 * Reported rather than deleted on purpose. Cleaning up here would keep the
 * database tidy and leave the specs wrong, and the next spec to leak would be
 * just as invisible.
 */
export async function describeRunProblem(): Promise<string | null> {
  const before = readRunBaseline();
  if (!before) {
    // A failure, rather than a warning and a skip. An absent baseline is not a
    // clean run, it is an unchecked one, and the difference is invisible in a
    // green result -- which is how a guard becomes decoration. Playwright does
    // not reach teardown at all when `global-setup` throws, so this cannot mask
    // a real setup failure: it means the recording was removed.
    return (
      'This run was not checked for leftover rows, because no baseline was recorded: '
      + '`global-setup` must call `recordRunBaseline(await captureRowSnapshot())` before '
      + 'the tests begin (#213).'
    );
  }

  return describeLeakedRows(rowsAddedDuringRun(before, await captureRowSnapshot()));
}

async function globalTeardown() {
  loadEnvConfig(process.cwd());

  const problem = await describeRunProblem();

  await prisma.authRateLimit.deleteMany();
  await prisma.$disconnect();

  // Reported after the cleanup, so the rate limits are cleared either way:
  // leaving a counted attempt behind would fail the *next* run, in a test
  // rather than here.
  if (problem) throw new Error(problem);
}

export default globalTeardown;
