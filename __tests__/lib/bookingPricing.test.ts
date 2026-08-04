/** @jest-environment node */
import {
    bookingTotalCents,
    flightFareCents,
} from '@/lib/bookingPricing';
import { calculateBookingTotal, calculateItineraryTotal, parsePriceToCents } from '@/lib/bookingPricing';

describe('authoritative booking pricing', () => {
    it('calculates cabin fares from the stored base price in integer cents', () => {
        expect(calculateBookingTotal('$350', [
            { cabinClass: 'ECONOMY' },
            { cabinClass: 'PREMIUM_ECONOMY' },
            { cabinClass: 'BUSINESS' },
            { cabinClass: 'FIRST' }
        ])).toEqual({ cents: 2_625_00, formatted: '$2,625' });
    });

    it('preserves cents without floating-point drift', () => {
        expect(calculateBookingTotal('$19.99', [
            { cabinClass: 'PREMIUM_ECONOMY' },
            { cabinClass: 'BUSINESS' }
        ])).toEqual({ cents: 6_997, formatted: '$69.97' });
    });

    it('rejects malformed, negative, and unsupported prices', () => {
        expect(() => parsePriceToCents('free')).toThrow('Flight price is invalid.');
        expect(() => parsePriceToCents('-$10')).toThrow('Flight price is invalid.');
        expect(() => parsePriceToCents('$10.999')).toThrow('Flight price is invalid.');
    });
});

describe('bookingTotalCents', () => {
    it('uses the stored total when the booking has one', () => {
        expect(bookingTotalCents({ totalPriceCents: 35_000 }, { priceCents: 99900 })).toBe(35_000);
    });

    it('falls back to the flight price for bookings taken before the column existed', () => {
        expect(bookingTotalCents({ totalPriceCents: null }, { priceCents: 35000 })).toBe(35_000);
    });

    it('treats a zero total as a real total rather than a missing one', () => {
        // A fully redeemed or waived booking must not silently re-price.
        expect(bookingTotalCents({ totalPriceCents: 0 }, { priceCents: 35000 })).toBe(0);
    });

    it('returns zero when neither a total nor a usable flight price exists', () => {
        expect(bookingTotalCents({ totalPriceCents: null }, null)).toBe(0);
        expect(bookingTotalCents({ totalPriceCents: null }, undefined)).toBe(0);
    });
});

describe('calculateItineraryTotal', () => {
    it('charges each leg at its own fare', () => {
        // A return leg is priced from its own flight, not doubled from the
        // outbound.
        const total = calculateItineraryTotal([35_000, 27_500], [{ cabinClass: 'ECONOMY' }]);

        expect(total.cents).toBe(62_500);
        expect(total.formatted).toBe('$625');
    });

    it('applies the cabin multiplier per passenger on every leg', () => {
        const total = calculateItineraryTotal(
            [10_000, 10_000],
            [{ cabinClass: 'ECONOMY' }, { cabinClass: 'BUSINESS' }],
        );

        // Economy 100 + Business 200, twice.
        expect(total.cents).toBe(60_000);
    });

    it('matches the single-leg total for a one-way itinerary', () => {
        expect(calculateItineraryTotal([35_000], [{ cabinClass: 'FIRST' }]))
            .toEqual(calculateBookingTotal('$350', [{ cabinClass: 'FIRST' }]));
    });

    it('rejects an itinerary with no legs', () => {
        expect(() => calculateItineraryTotal([], [{ cabinClass: 'ECONOMY' }]))
            .toThrow('An itinerary needs at least one flight.');
    });

    describe('flightFareCents', () => {
        it('reads the stored fare', () => {
            expect(flightFareCents({ priceCents: 35000 })).toBe(35000);
        });

        it('treats a zero fare as a fare, not as missing', () => {
            expect(flightFareCents({ priceCents: 0 })).toBe(0);
        });
    });
})
