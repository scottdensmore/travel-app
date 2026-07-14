/** @jest-environment node */
import { safePassengerSelect } from '@/lib/passengerDataAccess';

describe('passenger data access projections', () => {
    it('exposes only fields needed by routine customer and staff views', () => {
        expect(safePassengerSelect).toEqual({
            id: true,
            firstName: true,
            lastName: true,
            gender: true,
            seatNumber: true,
            cabinClass: true,
        });
        expect(safePassengerSelect).not.toHaveProperty('dateOfBirthEncrypted');
        expect(safePassengerSelect).not.toHaveProperty('passportNumberEncrypted');
    });
});
