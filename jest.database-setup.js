/**
 * Refuses to run the database project in parallel.
 *
 * These files share one Postgres and several assert against whole tables, so a
 * fixture another file is holding open gets counted and the run fails on work
 * that is not its own (#155). Splitting them into their own project is what
 * lets them be serialised; `--runInBand` in `npm run test:database` is what
 * actually serialises them.
 *
 * That left the guarantee resting on which command someone typed, and the
 * dangerous one is shorter: `npx jest --selectProjects database` looks
 * equivalent and runs the files in parallel, reproducing exactly the
 * interference the split removed. It cost a full afternoon of chasing failures
 * that looked like real regressions (#215).
 *
 * Jest has no per-project `maxWorkers`, so this cannot be configured away — but
 * a project's `globalSetup` is handed the resolved global config, which is
 * enough to refuse.
 */
function assertSerialised(globalConfig) {
    const maxWorkers = globalConfig?.maxWorkers ?? 1;

    if (maxWorkers > 1) {
        throw new Error(
            `The database test project must run one file at a time, and this run has `
            + `maxWorkers=${maxWorkers}. These files share one database and several `
            + `assert against whole tables, so in parallel they count each other's `
            + `fixtures and fail on work that is not their own (#155).\n\n`
            + `Use \`npm run test:database\`, which passes --runInBand, or add `
            + `--runInBand yourself.`
        );
    }
}

module.exports = async function databaseGlobalSetup(globalConfig) {
    assertSerialised(globalConfig);
};

// Jest only ever calls the default export. This one exists so
// `__tests__/harness/databaseSerialisation.test.ts` can drive the guard
// directly, which is the only way to assert it refuses a parallel run without
// starting one. It reads as dead code and is not.
module.exports.assertSerialised = assertSerialised;
