import { spawnSync } from 'child_process';
import path from 'path';

const entrypoint = path.resolve(__dirname, '../../scripts/container-entrypoint.sh');
const validEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@db:5432/travel_app',
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
    PASSENGER_DATA_ENCRYPTION_KEYS: 'test-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    AUTH_TRUSTED_PROXY_HOPS: '1',
    AUTH_EMAIL_FROM: 'Mona Airways <no-reply@localhost>',
    AUTH_EMAIL_PROVIDER: 'mailpit',
    AUTH_EMAIL_API_URL: 'http://mailpit:8025/api/v1/send',
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

    it.each([
        'DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_TRUSTED_PROXY_HOPS',
        'AUTH_EMAIL_FROM', 'AUTH_EMAIL_PROVIDER', 'AUTH_EMAIL_API_URL',
        'PASSENGER_DATA_ENCRYPTION_KEYS'
    ] as const)(
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

    it('rejects an invalid trusted proxy hop count', () => {
        const result = runEntrypoint({ ...validEnvironment, AUTH_TRUSTED_PROXY_HOPS: '0' });
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain(
            'AUTH_TRUSTED_PROXY_HOPS must be between 1 and 5'
        );
    });

    it('rejects plaintext Postmark delivery before startup', () => {
        const result = runEntrypoint({
            ...validEnvironment,
            NEXTAUTH_URL: 'https://travel.example.com',
            AUTH_EMAIL_PROVIDER: 'postmark',
            AUTH_EMAIL_API_URL: 'http://api.postmarkapp.com/email',
            AUTH_EMAIL_API_TOKEN: 'server-token',
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain(
            'Postmark AUTH_EMAIL_API_URL must use https://'
        );
    });

    it('rejects an HTTP public application origin for Postmark links', () => {
        const result = runEntrypoint({
            ...validEnvironment,
            NEXTAUTH_URL: 'http://travel.example.com',
            AUTH_EMAIL_PROVIDER: 'postmark',
            AUTH_EMAIL_API_URL: 'https://api.postmarkapp.com/email',
            AUTH_EMAIL_API_TOKEN: 'server-token',
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain(
            'Postmark NEXTAUTH_URL must use https://'
        );
    });
});
