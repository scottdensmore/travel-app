const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest. Shared by both projects below;
// only the file selection differs.
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/e2e/'],
}

// Matches the extensions Jest's default testMatch would pick up, so a
// `.database.test.tsx` cannot fall through to the parallel project and quietly
// reintroduce the collisions this split exists to remove.
const DATABASE_TESTS = '\\.database\\.test\\.[jt]sx?$'

/**
 * Two projects, because the database tests share one Postgres and must not run
 * beside each other.
 *
 * Several assert against whole tables on purpose — `seatAssignmentCoverage`
 * proves the invariant #137 relied on holds for data the test did not create —
 * so a fixture another file is holding open gets counted and the run fails on
 * work that is not its own (#155). Running them one file at a time removes the
 * overlap without weakening a single assertion.
 *
 * `npm run test:database` passes `--runInBand`, which is what actually
 * serialises them; splitting the projects is what lets it apply to those files
 * alone. It costs about 3s on those 9 files, and around 9s on the suite as a
 * whole once the two phases no longer interleave — roughly 21s to 31s. Worth
 * it for a result that does not depend on which files happen to overlap.
 *
 * createJestConfig is called this way to ensure next/jest can load the Next.js
 * config, which is async.
 */
module.exports = async () => ({
  projects: [
    await createJestConfig({
      ...customJestConfig,
      displayName: 'unit',
      testPathIgnorePatterns: [...customJestConfig.testPathIgnorePatterns, DATABASE_TESTS],
    })(),
    await createJestConfig({
      ...customJestConfig,
      displayName: 'database',
      testMatch: ['**/*.database.test.?(ts|tsx|js|jsx)'],
      // Refuses the run rather than letting it interfere quietly (#215).
      globalSetup: '<rootDir>/jest.database-setup.js',
    })(),
  ],
})
