/** @jest-environment node */
import {
    DEFAULT_SEATING_LAYOUT,
    isSeatAvailableForCabin,
    seatsForCabin,
} from '@/lib/seatLayout';

describe('legacy seating layout compatibility', () => {
    it('preserves the historical First and Business row boundary', () => {
        expect(isSeatAvailableForCabin('3A', 'FIRST', DEFAULT_SEATING_LAYOUT)).toBe(true);
        expect(isSeatAvailableForCabin('3A', 'BUSINESS', DEFAULT_SEATING_LAYOUT)).toBe(false);
        expect(isSeatAvailableForCabin('4A', 'BUSINESS', DEFAULT_SEATING_LAYOUT)).toBe(true);
        expect(isSeatAvailableForCabin('4A', 'FIRST', DEFAULT_SEATING_LAYOUT)).toBe(false);
    });
});

describe('seatsForCabin', () => {
    const compactLayout = {
        firstClassRows: 1,
        businessRows: 1,
        premiumEconomyRows: 0,
        economyRows: 2,
        seatPattern: 'AB-CD',
    };

    it('enumerates only the named cabin in row and seat order', () => {
        expect(seatsForCabin('BUSINESS', compactLayout)).toEqual([
            '2A', '2B', '2C', '2D',
        ]);
        expect(seatsForCabin('ECONOMY', compactLayout)).toEqual([
            '3A', '3B', '3C', '3D', '4A', '4B', '4C', '4D',
        ]);
    });

    it('returns no choices for an unavailable cabin', () => {
        expect(seatsForCabin('PREMIUM_ECONOMY', compactLayout)).toEqual([]);
    });
});
