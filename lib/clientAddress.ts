type HeaderCollection = Headers | Record<string, string | string[] | undefined> | undefined;

function readForwardedFor(headers: HeaderCollection): string | null {
    if (!headers) return null;
    if (headers instanceof Headers) return headers.get('x-forwarded-for');
    const value = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
    return Array.isArray(value) ? value.join(',') : value ?? null;
}

export function hasTrustedProxyConfiguration(
    configuredHops = process.env.AUTH_TRUSTED_PROXY_HOPS?.trim() ?? '0'
): boolean {
    return /^[1-5]$/.test(configuredHops);
}

export function getTrustedClientAddress(
    forwardedFor: string | null | undefined,
    configuredHops = process.env.AUTH_TRUSTED_PROXY_HOPS?.trim() ?? '0'
): string | null {
    if (!hasTrustedProxyConfiguration(configuredHops)) return null;
    const chain = forwardedFor?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
    const clientIndex = chain.length - Number(configuredHops);
    return clientIndex >= 0 ? chain[clientIndex] : null;
}

export function getTrustedClientAddressFromHeaders(headers: HeaderCollection): string | null {
    return getTrustedClientAddress(readForwardedFor(headers));
}
