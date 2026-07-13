const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidAuthToken(value: unknown): value is string {
    return typeof value === 'string' && AUTH_TOKEN_PATTERN.test(value);
}
