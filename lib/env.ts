type RequiredEnvironmentVariable = 'DATABASE_URL' | 'NEXTAUTH_URL' | 'NEXTAUTH_SECRET';
type Environment = Partial<Record<RequiredEnvironmentVariable, string | undefined>>;
type ValidatedEnvironment = Record<RequiredEnvironmentVariable, string>;

function requireValue(environment: Environment, key: RequiredEnvironmentVariable): string {
    const value = environment[key]?.trim();

    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }

    return value;
}

function parseUrl(value: string, key: RequiredEnvironmentVariable): URL {
    try {
        return new URL(value);
    } catch {
        throw new Error(`${key} must be a valid URL`);
    }
}

export function validateServerEnvironment(environment: Environment): ValidatedEnvironment {
    const DATABASE_URL = requireValue(environment, 'DATABASE_URL');
    const NEXTAUTH_URL = requireValue(environment, 'NEXTAUTH_URL');
    const NEXTAUTH_SECRET = requireValue(environment, 'NEXTAUTH_SECRET');

    const databaseUrl = parseUrl(DATABASE_URL, 'DATABASE_URL');
    if (!['postgresql:', 'postgres:'].includes(databaseUrl.protocol)) {
        throw new Error('DATABASE_URL must use the postgresql:// or postgres:// protocol');
    }

    let nextAuthUrl: URL;
    try {
        nextAuthUrl = new URL(NEXTAUTH_URL);
    } catch {
        throw new Error('NEXTAUTH_URL must be a valid http:// or https:// URL');
    }

    if (!['http:', 'https:'].includes(nextAuthUrl.protocol)) {
        throw new Error('NEXTAUTH_URL must be a valid http:// or https:// URL');
    }

    if (NEXTAUTH_SECRET.length < 32) {
        throw new Error('NEXTAUTH_SECRET must be at least 32 characters');
    }

    return { DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET };
}
