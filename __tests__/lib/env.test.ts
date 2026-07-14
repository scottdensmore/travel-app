import { validateServerEnvironment } from '@/lib/env';

const validEnvironment = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/travel_app',
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
    AUTH_EMAIL_FROM: 'Mona Airways <no-reply@localhost>',
    AUTH_EMAIL_PROVIDER: 'mailpit',
    AUTH_EMAIL_API_URL: 'http://localhost:8025/api/v1/send',
    PASSENGER_DATA_ENCRYPTION_KEYS: `local:${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`,
    STAFF_MFA_ENCRYPTION_KEYS: `local:${Buffer.from('abcdef0123456789abcdef0123456789').toString('base64')}`,
};

describe('validateServerEnvironment', () => {
    it('returns validated values when all required settings are present', () => {
        expect(validateServerEnvironment(validEnvironment)).toEqual(validEnvironment);
    });

    it.each([
        'DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_EMAIL_FROM',
        'AUTH_EMAIL_PROVIDER', 'AUTH_EMAIL_API_URL', 'PASSENGER_DATA_ENCRYPTION_KEYS',
        'STAFF_MFA_ENCRYPTION_KEYS'
    ] as const)(
        'rejects a missing %s',
        (key) => {
            const environment = { ...validEnvironment };
            delete environment[key];

            expect(() => validateServerEnvironment(environment)).toThrow(
                `Missing required environment variable: ${key}`
            );
        }
    );

    it('rejects malformed passenger-data encryption keys', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            PASSENGER_DATA_ENCRYPTION_KEYS: 'local:not-a-32-byte-key',
        })).toThrow('PASSENGER_DATA_ENCRYPTION_KEYS');
    });

    it('rejects malformed staff MFA encryption keys', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            STAFF_MFA_ENCRYPTION_KEYS: 'local:not-a-32-byte-key',
        })).toThrow('STAFF_MFA_ENCRYPTION_KEYS');
    });

    it('rejects a non-PostgreSQL database URL', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            DATABASE_URL: 'https://database.example.com/travel_app',
        })).toThrow('DATABASE_URL must use the postgresql:// or postgres:// protocol');
    });

    it('rejects an invalid NextAuth URL', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NEXTAUTH_URL: 'not-a-url',
        })).toThrow('NEXTAUTH_URL must be a valid http:// or https:// URL');
    });

    it('rejects a short NextAuth secret', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NEXTAUTH_SECRET: 'too-short',
        })).toThrow('NEXTAUTH_SECRET must be at least 32 characters');
    });

    it('requires a trusted proxy contract in production', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NODE_ENV: 'production',
            AUTH_TRUSTED_PROXY_HOPS: '0',
        })).toThrow('AUTH_TRUSTED_PROXY_HOPS must be between 1 and 5 in production');

        expect(validateServerEnvironment({
            ...validEnvironment,
            NODE_ENV: 'production',
            AUTH_TRUSTED_PROXY_HOPS: '1',
        })).toMatchObject({ AUTH_TRUSTED_PROXY_HOPS: '1' });
    });

    it('validates the email provider configuration', () => {
        expect(() => validateServerEnvironment({
            ...validEnvironment, AUTH_EMAIL_PROVIDER: 'smtp'
        })).toThrow('AUTH_EMAIL_PROVIDER must be mailpit or postmark');
        expect(() => validateServerEnvironment({
            ...validEnvironment, AUTH_EMAIL_API_URL: 'file:///tmp/mail'
        })).toThrow('AUTH_EMAIL_API_URL must be a valid http:// or https:// URL');
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NEXTAUTH_URL: 'https://travel.example.com',
            AUTH_EMAIL_PROVIDER: 'postmark',
            AUTH_EMAIL_API_URL: 'https://api.postmarkapp.com/email',
        })).toThrow('AUTH_EMAIL_API_TOKEN is required for Postmark');
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NEXTAUTH_URL: 'https://travel.example.com',
            AUTH_EMAIL_PROVIDER: 'postmark',
            AUTH_EMAIL_API_URL: 'http://api.postmarkapp.com/email',
            AUTH_EMAIL_API_TOKEN: 'server-token',
        })).toThrow('Postmark AUTH_EMAIL_API_URL must use https://');
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NEXTAUTH_URL: 'https://travel.example.com',
            AUTH_EMAIL_PROVIDER: 'postmark',
            AUTH_EMAIL_API_URL: 'https://example.com/email',
            AUTH_EMAIL_API_TOKEN: 'server-token',
        })).toThrow('Postmark AUTH_EMAIL_API_URL must be https://api.postmarkapp.com/email');
        expect(() => validateServerEnvironment({
            ...validEnvironment,
            NEXTAUTH_URL: 'http://travel.example.com',
            AUTH_EMAIL_PROVIDER: 'postmark',
            AUTH_EMAIL_API_URL: 'https://api.postmarkapp.com/email',
            AUTH_EMAIL_API_TOKEN: 'server-token',
        })).toThrow('Postmark NEXTAUTH_URL must use https://');
    });
});
