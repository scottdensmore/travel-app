import { spawnSync } from 'child_process';
import path from 'path';

const entrypoint = path.resolve(__dirname, '../../scripts/container-entrypoint.sh');
const validEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@db:5432/travel_app',
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
};

function runEntrypoint(environment: NodeJS.ProcessEnv) {
    return spawnSync('sh', [entrypoint, 'true'], {
        env: environment,
        encoding: 'utf8',
    });
}

describe('container entrypoint', () => {
    it('starts the requested command when configuration is valid', () => {
        expect(runEntrypoint(validEnvironment).status).toBe(0);
    });

    it.each(['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET'] as const)(
        'fails before startup when %s is missing',
        (key) => {
            const environment = { ...validEnvironment };
            delete environment[key];

            const result = runEntrypoint(environment);

            expect(result.status).not.toBe(0);
            expect(`${result.stdout}${result.stderr}`).toContain(
                `Missing required environment variable: ${key}`
            );
        }
    );

    it('rejects invalid URL protocols and short secrets', () => {
        const invalidDatabase = runEntrypoint({
            ...validEnvironment,
            DATABASE_URL: 'https://database.example.com/travel_app',
        });
        const invalidNextAuth = runEntrypoint({
            ...validEnvironment,
            NEXTAUTH_URL: 'ftp://localhost:3000',
        });
        const shortSecret = runEntrypoint({
            ...validEnvironment,
            NEXTAUTH_SECRET: 'too-short',
        });

        expect(invalidDatabase.status).not.toBe(0);
        expect(invalidNextAuth.status).not.toBe(0);
        expect(shortSecret.status).not.toBe(0);
    });
});
