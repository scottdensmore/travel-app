/**
 * Generates a sanitized, deterministic customer-safe incident reference code.
 *
 * If Next.js attaches a server-side error digest, we sanitize and format it as
 * `ERR-<DIGEST>`. If no digest is available (e.g. client runtime errors), we
 * deterministically hash the error signature, ensuring that raw stack
 * traces, SQL queries, and file paths are never leaked to the customer.
 */
export function generateIncidentCode(error?: (Error & { digest?: string }) | null): string {
    if (error?.digest) {
        const sanitized = error.digest.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (sanitized.length >= 6) {
            return `ERR-${sanitized.slice(0, 10)}`;
        }
        if (sanitized.length > 0) {
            return `ERR-${sanitized.padEnd(6, '0')}`;
        }
    }

    const seed = `${error?.name || 'Error'}:${error?.message || ''}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    return `ERR-${hex}`;
}
