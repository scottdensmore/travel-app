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

/**
 * A flight's fare in minor units.
 *
 * Trivial now that the fare is stored in one form (#135). Kept as the single
 * accessor so callers still name what they are reading, and so a future change
 * of representation has one place to happen.
 */
export function flightFareCents(flight: { priceCents: number }): number {
    return flight.priceCents;
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

/**
 * The total for an itinerary, in minor units.
 *
 * Each leg is charged at its own flight's fare: a return leg costs what that
 * flight costs, not a repeat of the outbound. The cabin multiplier applies to
 * every passenger on every leg.
 */
export function calculateItineraryTotal(
    legFareCents: number[],
    passengers: Array<{ cabinClass: CabinClass }>
): { cents: number; formatted: string } {
    if (legFareCents.length === 0) {
        throw new Error('An itinerary needs at least one flight.');
    }

    // Fares arrive as minor units rather than formatted strings, so the total
    // no longer depends on parsing text the application itself formatted (#70).
    const cents = legFareCents.reduce(
        (total, fare) => total + passengers.reduce(
            (legTotal, passenger) =>
                legTotal + calculatePassengerFareCents(fare, passenger.cabinClass),
            0
        ),
        0
    );

    return { cents, formatted: formatPrice(cents) };
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
    flight: { priceCents: number } | null | undefined,
): number {
    if (booking.totalPriceCents !== null && booking.totalPriceCents !== undefined) {
        return booking.totalPriceCents;
    }
    return flight?.priceCents ?? 0;
}
