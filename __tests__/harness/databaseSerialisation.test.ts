/** @jest-environment node */
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertSerialised } = require('../../jest.database-setup.js');

const repositoryRoot = path.resolve(__dirname, '../..');

/**
 * The database project cannot be run in parallel by accident.
 *
 * Its files share one Postgres and several assert against whole tables, so
 * beside each other they count one another's fixtures (#155). Splitting them
 * into their own project is what allows serialisation; `--runInBand` in the npm
 * script is what performs it — which left the guarantee resting on which
 * command someone typed, with the dangerous one being the shorter
 * `npx jest --selectProjects database` (#215).
 *
 * Jest has no per-project `maxWorkers`, so the guard lives in the project's
 * `globalSetup` and this pins both halves: that the guard refuses, and that the
 * config still points at it.
 */
describe('the database project refuses to run in parallel', () => {
    it('accepts a serialised run', () => {
        expect(() => assertSerialised({ maxWorkers: 1 })).not.toThrow();
    });

    it('accepts a config that does not mention workers', () => {
        // Absent is not "many": defaulting the other way would refuse runs that
        // are perfectly safe.
        expect(() => assertSerialised({})).not.toThrow();
        expect(() => assertSerialised(undefined)).not.toThrow();
    });

    it.each([2, 4, 23])('refuses maxWorkers=%i', (maxWorkers) => {
        expect(() => assertSerialised({ maxWorkers })).toThrow(/one file at a time/);
    });

    it('says how many workers it saw, and what to run instead', () => {
        // Whoever hits this is mid-run and needs the remedy in the message,
        // not a pointer to an issue.
        expect(() => assertSerialised({ maxWorkers: 8 }))
            .toThrow(/maxWorkers=8[\s\S]*npm run test:database/);
    });

    it('is wired into the database project, and only that project', () => {
        // The guard is inert if the config stops pointing at it, and running it
        // for the unit project would refuse every parallel run in the repo.
        const config = fs.readFileSync(path.join(repositoryRoot, 'jest.config.js'), 'utf8');
        const databaseProject = config.slice(config.indexOf("displayName: 'database'"));
        const unitProject = config.slice(
            config.indexOf("displayName: 'unit'"),
            config.indexOf("displayName: 'database'"),
        );

        expect(databaseProject).toContain('jest.database-setup.js');
        expect(unitProject).not.toContain('globalSetup');
        expect(fs.existsSync(path.join(repositoryRoot, 'jest.database-setup.js'))).toBe(true);
    });
});
