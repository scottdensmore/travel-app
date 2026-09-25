import {
    calculateAwardFareQuote,
    CABIN_AWARD_POINTS,
    MANDATORY_AWARD_TAX_CENTS_PER_LEG,
    isAwardAvailableForFlight,
    getAwardSeatsAvailableForCabin,
    type AwardFareQuote,
} from '@/lib/rewardPricing';

describe('rewardPricing', () => {
    describe('calculateAwardFareQuote', () => {
        it('computes exact points and mandatory taxes for single-leg economy flight', () => {
            const quote: AwardFareQuote = calculateAwardFareQuote({
                cabinClass: 'ECONOMY',
                legCount: 1,
                passengerCount: 1,
            });

            expect(quote.totalPointsRequired).toBe(15000);
            expect(quote.totalTaxesCents).toBe(1010); // $10.10
            expect(quote.formattedPoints).toBe('15,000 pts');
            expect(quote.formattedTaxes).toBe('$10.10');
            expect(quote.pointsPerPassengerLeg).toBe(15000);
            expect(quote.taxesPerPassengerLegCents).toBe(1010);
            expect(quote.cabinClass).toBe('ECONOMY');
            expect(quote.legCount).toBe(1);
            expect(quote.passengerCount).toBe(1);
        });

        it('scales points and taxes linearly for round-trip business with 2 passengers', () => {
            const quote: AwardFareQuote = calculateAwardFareQuote({
                cabinClass: 'BUSINESS',
                legCount: 2,
                passengerCount: 2,
            });

            // 40,000 pts * 2 legs * 2 passengers = 160,000 pts
            expect(quote.totalPointsRequired).toBe(160000);
            // 1010 cents * 2 legs * 2 passengers = 4040 cents ($40.40)
            expect(quote.totalTaxesCents).toBe(4040);
            expect(quote.formattedPoints).toBe('160,000 pts');
            expect(quote.formattedTaxes).toBe('$40.40');
            expect(quote.pointsPerPassengerLeg).toBe(40000);
            expect(quote.taxesPerPassengerLegCents).toBe(1010);
            expect(quote.cabinClass).toBe('BUSINESS');
            expect(quote.legCount).toBe(2);
            expect(quote.passengerCount).toBe(2);
        });

        it('computes points for premium economy and first class', () => {
            const premiumQuote = calculateAwardFareQuote({
                cabinClass: 'PREMIUM_ECONOMY',
                legCount: 1,
                passengerCount: 1,
            });
            expect(premiumQuote.totalPointsRequired).toBe(25000);
            expect(premiumQuote.formattedPoints).toBe('25,000 pts');

            const firstQuote = calculateAwardFareQuote({
                cabinClass: 'FIRST',
                legCount: 1,
                passengerCount: 1,
            });
            expect(firstQuote.totalPointsRequired).toBe(60000);
            expect(firstQuote.formattedPoints).toBe('60,000 pts');
        });

        it('handles multi-leg itinerary (e.g. 3 legs, 3 passengers in First)', () => {
            const quote = calculateAwardFareQuote({
                cabinClass: 'FIRST',
                legCount: 3,
                passengerCount: 3,
            });
            // 60,000 * 3 * 3 = 540,000 pts
            expect(quote.totalPointsRequired).toBe(540000);
            // 1010 * 3 * 3 = 9090 cents ($90.90)
            expect(quote.totalTaxesCents).toBe(9090);
            expect(quote.formattedPoints).toBe('540,000 pts');
            expect(quote.formattedTaxes).toBe('$90.90');
        });
    });

    describe('CABIN_AWARD_POINTS and constants', () => {
        it('has expected fixed values for each cabin', () => {
            expect(CABIN_AWARD_POINTS.ECONOMY).toBe(15000);
            expect(CABIN_AWARD_POINTS.PREMIUM_ECONOMY).toBe(25000);
            expect(CABIN_AWARD_POINTS.BUSINESS).toBe(40000);
            expect(CABIN_AWARD_POINTS.FIRST).toBe(60000);
            expect(MANDATORY_AWARD_TAX_CENTS_PER_LEG).toBe(1010);
        });
    });

    describe('getAwardSeatsAvailableForCabin', () => {
        it('returns correct remaining seats for each cabin class', () => {
            const flight = {
                awardSeatsEconomy: 4,
                awardSeatsPremiumEconomy: 3,
                awardSeatsBusiness: 2,
                awardSeatsFirst: 1,
            };
            expect(getAwardSeatsAvailableForCabin(flight, 'ECONOMY')).toBe(4);
            expect(getAwardSeatsAvailableForCabin(flight, 'PREMIUM_ECONOMY')).toBe(3);
            expect(getAwardSeatsAvailableForCabin(flight, 'BUSINESS')).toBe(2);
            expect(getAwardSeatsAvailableForCabin(flight, 'FIRST')).toBe(1);
        });

        it('returns schema defaults if fields are not present on flight', () => {
            const flight = {};
            expect(getAwardSeatsAvailableForCabin(flight, 'ECONOMY')).toBe(4);
            expect(getAwardSeatsAvailableForCabin(flight, 'PREMIUM_ECONOMY')).toBe(2);
            expect(getAwardSeatsAvailableForCabin(flight, 'BUSINESS')).toBe(2);
            expect(getAwardSeatsAvailableForCabin(flight, 'FIRST')).toBe(1);
        });

        it('respects zero remaining seats', () => {
            const flight = { awardSeatsEconomy: 0 };
            expect(getAwardSeatsAvailableForCabin(flight, 'ECONOMY')).toBe(0);
        });
    });

    describe('isAwardAvailableForFlight', () => {
        it('returns true when available seats meet or exceed passenger count', () => {
            const flight = { awardSeatsEconomy: 2 };
            expect(isAwardAvailableForFlight(flight, 'ECONOMY', 1)).toBe(true);
            expect(isAwardAvailableForFlight(flight, 'ECONOMY', 2)).toBe(true);
        });

        it('returns false when requested passenger count exceeds available award seats', () => {
            const flight = { awardSeatsEconomy: 2 };
            expect(isAwardAvailableForFlight(flight, 'ECONOMY', 3)).toBe(false);
        });

        it('returns false when zero seats available', () => {
            const flight = { awardSeatsEconomy: 0 };
            expect(isAwardAvailableForFlight(flight, 'ECONOMY', 1)).toBe(false);
        });

        it('defaults passengerCount to 1', () => {
            const flight = { awardSeatsBusiness: 1 };
            expect(isAwardAvailableForFlight(flight, 'BUSINESS')).toBe(true);
        });

        it('returns false when passengerCount <= 0', () => {
            const flight = { awardSeatsBusiness: 5 };
            expect(isAwardAvailableForFlight(flight, 'BUSINESS', 0)).toBe(false);
            expect(isAwardAvailableForFlight(flight, 'BUSINESS', -1)).toBe(false);
        });
    });
});
