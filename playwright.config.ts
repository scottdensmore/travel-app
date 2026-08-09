import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI to avoid DB collisions */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/reporters */
  reporter: process.env.CI ? 'dot' : 'html',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // Never reuse a server this run did not start.
    //
    // Reusing one silently served stale output: a healthy branch failed three
    // runs out of three and looked like a regression, and the bisect that
    // followed was worthless because `npm run build` changes nothing when the
    // server is `next dev`. The mirror case is worse -- a stale server can
    // report a pass for code that is not the code under test (#196).
    //
    // The cost is that a dev server already on this port now stops the suite
    // rather than being borrowed. That is the point: a loud refusal beats a
    // quiet wrong answer.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120000,
  },
});
