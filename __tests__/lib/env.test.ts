import { validateServerEnvironment } from '@/lib/env';

const validEnvironment = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/travel_app',
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
};

describe('validateServerEnvironment', () => {
    it('returns validated values when all required settings are present', () => {
        expect(validateServerEnvironment(validEnvironment)).toEqual(validEnvironment);
    });

    it.each(['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET'] as const)(
        'rejects a missing %s',
        (key) => {
            const environment = { ...validEnvironment };
            delete environment[key];

            expect(() => validateServerEnvironment(environment)).toThrow(
                `Missing required environment variable: ${key}`
            );
        }
    );

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
});
