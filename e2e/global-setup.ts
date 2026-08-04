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

async function globalSetup(config: FullConfig): Promise<void> {
  loadEnvConfig(process.cwd());

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  await warmAuthRoutes(baseURL);

  // Last, so that nothing this file asked for can leave a counted attempt
  // behind for the first test to trip over.
  await prisma.authRateLimit.deleteMany();
  await prisma.$disconnect();
}

export default globalSetup;
