export const CABIN_FARE_PERCENT = {
    ECONOMY: 100,
    PREMIUM_ECONOMY: 150,
    BUSINESS: 200,
    FIRST: 300
} as const;

export type CabinClass = keyof typeof CABIN_FARE_PERCENT;

export function parsePriceToCents(price: string): number {
    const normalized = price.trim();
    if (!/^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(normalized)) {
        throw new Error('Flight price is invalid.');
    }

    const numeric = normalized.replace(/[$,]/g, '');
    const [whole, fraction = ''] = numeric.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents < 0) {
        throw new Error('Flight price is invalid.');
    }
    return cents;
}

export function calculatePassengerFareCents(basePriceCents: number, cabinClass: CabinClass): number {
    return Math.round(basePriceCents * CABIN_FARE_PERCENT[cabinClass] / 100);
}

export function formatPrice(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
        maximumFractionDigits: cents % 100 === 0 ? 0 : 2
    }).format(cents / 100);
}

export function calculateBookingTotal(
    basePrice: string,
    passengers: Array<{ cabinClass: CabinClass }>
): { cents: number; formatted: string } {
    const basePriceCents = parsePriceToCents(basePrice);
    const cents = passengers.reduce(
        (sum, passenger) => sum + calculatePassengerFareCents(basePriceCents, passenger.cabinClass),
        0
    );
    return { cents, formatted: formatPrice(cents) };
}

/**
 * The total a booking was actually taken at, in minor units.
 *
 * Bookings created before the total was stored as an integer fall back to the
 * flight's catalogue price, which is what an empty total already did. A stored
 * zero is a real total — a waived or fully redeemed booking must not silently
 * re-price against the current catalogue.
 *
 * An unparseable catalogue price yields zero rather than throwing: awarding no
 * points is better than failing a cancellation or a profile page.
 */
export function bookingTotalCents(
    booking: { totalPriceCents: number | null },
    flight: { price: string } | null | undefined,
): number {
    if (booking.totalPriceCents !== null && booking.totalPriceCents !== undefined) {
        return booking.totalPriceCents;
    }
    if (!flight) return 0;

    try {
        return parsePriceToCents(flight.price);
    } catch {
        return 0;
    }
}
