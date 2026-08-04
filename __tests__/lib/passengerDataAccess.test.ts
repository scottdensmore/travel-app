/** @jest-environment node */
import { safePassengerSelect } from '@/lib/passengerDataAccess';

describe('passenger data access projections', () => {
    it('exposes only fields needed by routine customer and staff views', () => {
        // A traveller is a person. Where they sit is a SeatAssignment per leg,
        // so no seat or cabin appears in the traveller projection (#137).
        expect(safePassengerSelect).toEqual({
            id: true,
            firstName: true,
            lastName: true,
            gender: true,
        });
        expect(safePassengerSelect).not.toHaveProperty('seatNumber');
        expect(safePassengerSelect).not.toHaveProperty('cabinClass');
        expect(safePassengerSelect).not.toHaveProperty('flightId');
        expect(safePassengerSelect).not.toHaveProperty('dateOfBirthEncrypted');
        expect(safePassengerSelect).not.toHaveProperty('passportNumberEncrypted');
    });
});
