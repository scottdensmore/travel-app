/** @jest-environment node */
import fs from 'fs';
import path from 'path';

const databaseGlobalSetup = require('../../jest.database-setup.js');
const { assertSerialised, assertDisposableDatabase } = databaseGlobalSetup;

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

describe('the database project refuses to run against non-disposable databases', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('refuses if DATABASE_URL is not set', () => {
        delete process.env.DATABASE_URL;
        process.env.DATABASE_IS_DISPOSABLE = 'true';
        expect(() => assertDisposableDatabase()).toThrow(
            'Refusing to clear bookings: DATABASE_URL is not set.'
        );
    });

    it('refuses if DATABASE_IS_DISPOSABLE is not "true"', () => {
        process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/travel_app';

        delete process.env.DATABASE_IS_DISPOSABLE;
        expect(() => assertDisposableDatabase()).toThrow(
            /DATABASE_IS_DISPOSABLE is not set to "true"/
        );

        process.env.DATABASE_IS_DISPOSABLE = 'false';
        expect(() => assertDisposableDatabase()).toThrow(
            /DATABASE_IS_DISPOSABLE is not set to "true"/
        );

        process.env.DATABASE_IS_DISPOSABLE = '1';
        expect(() => assertDisposableDatabase()).toThrow(
            /DATABASE_IS_DISPOSABLE is not set to "true"/
        );
    });

    it('refuses if DATABASE_URL cannot be parsed as a URL', () => {
        process.env.DATABASE_URL = 'not a valid url';
        process.env.DATABASE_IS_DISPOSABLE = 'true';
        expect(() => assertDisposableDatabase()).toThrow(
            'Refusing to clear bookings: DATABASE_URL is not a URL this can check.'
        );
    });

    it.each([
        'postgresql://postgres:postgres@production.example.com:5432/travel_app',
        'postgresql://postgres:postgres@staging.internal:5432/travel_app',
        'postgresql://postgres:postgres@10.0.0.1:5432/travel_app',
    ])('refuses untrusted host %s', (url) => {
        process.env.DATABASE_URL = url;
        process.env.DATABASE_IS_DISPOSABLE = 'true';
        expect(() => assertDisposableDatabase()).toThrow(
            /is not one this suite may destroy data on/
        );
    });

    it.each([
        'postgresql://postgres:postgres@localhost:5432/production',
        'postgresql://postgres:postgres@127.0.0.1:5432/travel_app_prod',
        'postgresql://postgres:postgres@db:5432/analytics',
    ])('refuses unapproved database name %s', (url) => {
        process.env.DATABASE_URL = url;
        process.env.DATABASE_IS_DISPOSABLE = 'true';
        expect(() => assertDisposableDatabase()).toThrow(
            /which this suite does not own/
        );
    });

    it.each([
        'postgresql://postgres:postgres@localhost:5432/travel_app',
        'postgresql://postgres:postgres@127.0.0.1:5432/travel_app',
        'postgresql://postgres:postgres@db:5432/travel_app',
        'postgresql://postgres:postgres@[::1]:5432/travel_app',
        'postgresql://postgres:postgres@localhost:5432/custom_test',
        'postgresql://postgres:postgres@127.0.0.1:5432/travel_app_test',
        'postgresql://postgres:postgres@db:5432/service_test',
    ])('accepts valid configuration %s', (url) => {
        process.env.DATABASE_URL = url;
        process.env.DATABASE_IS_DISPOSABLE = 'true';
        expect(() => assertDisposableDatabase()).not.toThrow();
    });

    it('is invoked by databaseGlobalSetup alongside serialisation check', async () => {
        process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/travel_app';
        process.env.DATABASE_IS_DISPOSABLE = 'true';

        // Valid configuration and serialised run succeeds
        await expect(databaseGlobalSetup({ maxWorkers: 1 })).resolves.toBeUndefined();

        // Parallel run fails
        await expect(databaseGlobalSetup({ maxWorkers: 2 })).rejects.toThrow(
            /one file at a time/
        );

        // Non-disposable database fails
        process.env.DATABASE_IS_DISPOSABLE = 'false';
        await expect(databaseGlobalSetup({ maxWorkers: 1 })).rejects.toThrow(
            /DATABASE_IS_DISPOSABLE is not set to "true"/
        );
    });
});

