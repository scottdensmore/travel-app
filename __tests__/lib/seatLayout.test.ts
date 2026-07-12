/** @jest-environment node */
import { DEFAULT_SEATING_LAYOUT, isSeatAvailableForCabin } from '@/lib/seatLayout';

describe('legacy seating layout compatibility', () => {
    it('preserves the historical First and Business row boundary', () => {
        expect(isSeatAvailableForCabin('3A', 'FIRST', DEFAULT_SEATING_LAYOUT)).toBe(true);
        expect(isSeatAvailableForCabin('3A', 'BUSINESS', DEFAULT_SEATING_LAYOUT)).toBe(false);
        expect(isSeatAvailableForCabin('4A', 'BUSINESS', DEFAULT_SEATING_LAYOUT)).toBe(true);
        expect(isSeatAvailableForCabin('4A', 'FIRST', DEFAULT_SEATING_LAYOUT)).toBe(false);
    });
});
