export const DEFAULT_ACCOUNT_TIME_ZONE = 'UTC';

/**
 * Turn an IANA name or alias into the canonical name the runtime recognizes.
 *
 * `Intl` is the same timezone database used for flight clocks. Asking it to
 * resolve the name avoids maintaining a second, drifting allowlist while still
 * rejecting arbitrary strings before they reach the account row.
 */
export function normalizeAccountTimeZone(value: string): string | null {
    const candidate = value.trim();
    if (candidate.length === 0 || candidate.length > 100) return null;

    try {
        return new Intl.DateTimeFormat('en-US', { timeZone: candidate })
            .resolvedOptions().timeZone;
    } catch {
        return null;
    }
}

/** Every runtime-supported customer choice, plus the explicit UTC fallback. */
export function accountTimeZoneChoices(): string[] {
    return [
        DEFAULT_ACCOUNT_TIME_ZONE,
        ...Intl.supportedValuesOf('timeZone').filter(zone => zone !== DEFAULT_ACCOUNT_TIME_ZONE),
    ];
}

/** An account instant in the timezone the customer chose, with the zone named. */
export function formatAccountDateTime(
    value: Date | string,
    timeZone: string,
): string {
    const zone = normalizeAccountTimeZone(timeZone) ?? DEFAULT_ACCOUNT_TIME_ZONE;
    return new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        month: 'long',
        timeZone: zone,
        timeZoneName: 'short',
        year: 'numeric',
    }).format(new Date(value));
}
