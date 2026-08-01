/** @jest-environment node */
import { bookingTotalCents } from '@/lib/bookingPricing';
import { calculateBookingTotal, parsePriceToCents } from '@/lib/bookingPricing';

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
        expect(bookingTotalCents({ totalPriceCents: 35_000 }, { price: '$999' })).toBe(35_000);
    });

    it('falls back to the flight price for bookings taken before the column existed', () => {
        expect(bookingTotalCents({ totalPriceCents: null }, { price: '$350' })).toBe(35_000);
    });

    it('treats a zero total as a real total rather than a missing one', () => {
        // A fully redeemed or waived booking must not silently re-price.
        expect(bookingTotalCents({ totalPriceCents: 0 }, { price: '$350' })).toBe(0);
    });

    it('returns zero when neither a total nor a usable flight price exists', () => {
        expect(bookingTotalCents({ totalPriceCents: null }, null)).toBe(0);
        expect(bookingTotalCents({ totalPriceCents: null }, { price: 'not a price' })).toBe(0);
    });
});
