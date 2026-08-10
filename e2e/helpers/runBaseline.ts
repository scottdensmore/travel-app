import type { RowSnapshot } from './rowSnapshot';

/**
 * What the database held before the run, held between `global-setup` and
 * `global-teardown`.
 *
 * Playwright runs both in the runner process, so a module variable is enough to
 * carry it and there is no file to leave behind or read stale. If that ever
 * stops being true the baseline reads as absent, which `global-teardown` says
 * out loud rather than treating as "nothing leaked".
 */
let baseline: RowSnapshot | null = null;

export function recordRunBaseline(snapshot: RowSnapshot): void {
  baseline = snapshot;
}

export function readRunBaseline(): RowSnapshot | null {
  return baseline;
}
