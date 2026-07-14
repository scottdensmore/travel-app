import { parsePassengerDataEncryptionKeys } from '@/lib/passengerDataProtection';

type RequiredEnvironmentVariable =
    | 'DATABASE_URL'
    | 'NEXTAUTH_URL'
    | 'NEXTAUTH_SECRET'
    | 'AUTH_EMAIL_FROM'
    | 'AUTH_EMAIL_PROVIDER'
    | 'AUTH_EMAIL_API_URL'
    | 'PASSENGER_DATA_ENCRYPTION_KEYS';
type Environment = Partial<Record<RequiredEnvironmentVariable, string | undefined>> & {
    NODE_ENV?: string;
    AUTH_TRUSTED_PROXY_HOPS?: string;
    AUTH_EMAIL_API_TOKEN?: string;
};
type ValidatedEnvironment = Record<RequiredEnvironmentVariable, string> & {
    AUTH_TRUSTED_PROXY_HOPS?: string;
    AUTH_EMAIL_API_TOKEN?: string;
};

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
    const AUTH_EMAIL_FROM = requireValue(environment, 'AUTH_EMAIL_FROM');
    const AUTH_EMAIL_PROVIDER = requireValue(environment, 'AUTH_EMAIL_PROVIDER');
    const AUTH_EMAIL_API_URL = requireValue(environment, 'AUTH_EMAIL_API_URL');
    const PASSENGER_DATA_ENCRYPTION_KEYS = requireValue(environment, 'PASSENGER_DATA_ENCRYPTION_KEYS');
    parsePassengerDataEncryptionKeys(PASSENGER_DATA_ENCRYPTION_KEYS);

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

    if (/\r|\n/.test(AUTH_EMAIL_FROM)) {
        throw new Error('AUTH_EMAIL_FROM must not contain line breaks');
    }
    if (!['mailpit', 'postmark'].includes(AUTH_EMAIL_PROVIDER)) {
        throw new Error('AUTH_EMAIL_PROVIDER must be mailpit or postmark');
    }
    const authEmailApiUrl = parseUrl(AUTH_EMAIL_API_URL, 'AUTH_EMAIL_API_URL');
    if (!['http:', 'https:'].includes(authEmailApiUrl.protocol)) {
        throw new Error('AUTH_EMAIL_API_URL must be a valid http:// or https:// URL');
    }
    if (AUTH_EMAIL_PROVIDER === 'postmark' && authEmailApiUrl.protocol !== 'https:') {
        throw new Error('Postmark AUTH_EMAIL_API_URL must use https://');
    }
    if (AUTH_EMAIL_PROVIDER === 'postmark'
        && (authEmailApiUrl.hostname !== 'api.postmarkapp.com' || authEmailApiUrl.pathname !== '/email')) {
        throw new Error('Postmark AUTH_EMAIL_API_URL must be https://api.postmarkapp.com/email');
    }
    if (AUTH_EMAIL_PROVIDER === 'postmark' && nextAuthUrl.protocol !== 'https:') {
        throw new Error('Postmark NEXTAUTH_URL must use https://');
    }
    const AUTH_EMAIL_API_TOKEN = environment.AUTH_EMAIL_API_TOKEN?.trim();
    if (AUTH_EMAIL_PROVIDER === 'postmark' && !AUTH_EMAIL_API_TOKEN) {
        throw new Error('AUTH_EMAIL_API_TOKEN is required for Postmark');
    }

    const AUTH_TRUSTED_PROXY_HOPS = environment.AUTH_TRUSTED_PROXY_HOPS?.trim();
    if (environment.NODE_ENV === 'production' && !/^[1-5]$/.test(AUTH_TRUSTED_PROXY_HOPS ?? '')) {
        throw new Error('AUTH_TRUSTED_PROXY_HOPS must be between 1 and 5 in production');
    }

    return {
        DATABASE_URL,
        NEXTAUTH_URL,
        NEXTAUTH_SECRET,
        AUTH_EMAIL_FROM,
        AUTH_EMAIL_PROVIDER,
        AUTH_EMAIL_API_URL,
        PASSENGER_DATA_ENCRYPTION_KEYS,
        ...(AUTH_EMAIL_API_TOKEN ? { AUTH_EMAIL_API_TOKEN } : {}),
        ...(AUTH_TRUSTED_PROXY_HOPS ? { AUTH_TRUSTED_PROXY_HOPS } : {})
    };
}
