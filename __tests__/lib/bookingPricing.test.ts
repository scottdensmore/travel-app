/** @jest-environment node */
import {
    bookingTotalCents,
    calculateBookingAncillariesTotalCents,
    calculatePassengerAncillaries,
    flightFareCents,
    getAncillaryPriceCents,
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
});

describe('ancillary pricing and cabin allowances', () => {
    it('prices Economy checked bags and priority boarding correctly', () => {
        const result = calculatePassengerAncillaries('ECONOMY', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(result.totalCents).toBe(3500 + 4500 + 1500); // 9500 cents
        expect(result.items.find(i => i.type === 'CARRY_ON')?.priceCents).toBe(0);
        expect(result.items.find(i => i.type === 'CHECKED_BAG_1')?.priceCents).toBe(3500);
        expect(result.items.find(i => i.type === 'CHECKED_BAG_2')?.priceCents).toBe(4500);
        expect(result.items.find(i => i.type === 'PRIORITY_BOARDING')?.priceCents).toBe(1500);
    });

    it('gives Premium Economy 1 free checked bag and free carry-on', () => {
        const result = calculatePassengerAncillaries('PREMIUM_ECONOMY', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(result.totalCents).toBe(0 + 4500 + 1500); // 6000 cents
        expect(result.items.find(i => i.type === 'CHECKED_BAG_1')?.priceCents).toBe(0);
    });

    it('gives Business and First class 2 free checked bags and free priority boarding', () => {
        const bizResult = calculatePassengerAncillaries('BUSINESS', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(bizResult.totalCents).toBe(0);

        const firstResult = calculatePassengerAncillaries('FIRST', ['CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING']);
        expect(firstResult.totalCents).toBe(0);
    });

    it('calculates total for booking across multiple passengers', () => {
        const total = calculateBookingAncillariesTotalCents([
            { cabin: 'ECONOMY', ancillaries: ['CHECKED_BAG_1', 'PRIORITY_BOARDING'] },
            { cabin: 'BUSINESS', ancillaries: ['CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING'] },
            { cabin: 'ECONOMY', ancillaries: [] },
            { cabin: 'PREMIUM_ECONOMY' },
        ]);
        expect(total).toBe(5000);
    });

    it('calculates individual ancillary prices directly with getAncillaryPriceCents', () => {
        expect(getAncillaryPriceCents('CARRY_ON', 'ECONOMY')).toBe(0);
        expect(getAncillaryPriceCents('SPECIAL_ASSISTANCE', 'ECONOMY')).toBe(0);
        expect(getAncillaryPriceCents('CHECKED_BAG_1', 'ECONOMY')).toBe(3500);
        expect(getAncillaryPriceCents('CHECKED_BAG_2', 'ECONOMY')).toBe(4500);
        expect(getAncillaryPriceCents('PRIORITY_BOARDING', 'ECONOMY')).toBe(1500);

        expect(getAncillaryPriceCents('CHECKED_BAG_1', 'PREMIUM_ECONOMY')).toBe(0);
        expect(getAncillaryPriceCents('CHECKED_BAG_2', 'PREMIUM_ECONOMY')).toBe(4500);
        expect(getAncillaryPriceCents('PRIORITY_BOARDING', 'PREMIUM_ECONOMY')).toBe(1500);

        expect(getAncillaryPriceCents('CHECKED_BAG_1', 'BUSINESS')).toBe(0);
        expect(getAncillaryPriceCents('CHECKED_BAG_2', 'BUSINESS')).toBe(0);
        expect(getAncillaryPriceCents('PRIORITY_BOARDING', 'BUSINESS')).toBe(0);

        expect(getAncillaryPriceCents('CHECKED_BAG_1', 'FIRST')).toBe(0);
        expect(getAncillaryPriceCents('CHECKED_BAG_2', 'FIRST')).toBe(0);
        expect(getAncillaryPriceCents('PRIORITY_BOARDING', 'FIRST')).toBe(0);
    });
});
