/** @jest-environment node */
import { FlightStatus } from '@prisma/client';
import { flightStatusSchema } from '@/lib/validation';
import { FLIGHT_STATUSES, flightStatusLabel, flightStatusStyle } from '@/lib/flightStatus';

/**
 * Two independent lists of the same three statuses.
 *
 * The database now says which statuses exist (#73). The request boundary has to
 * agree with it: a status the schema accepts but the column refuses is a write
 * that fails after an administrator has already been told it worked, and one
 * the column accepts but the schema refuses is unreachable.
 */
const STATUSES = Object.values(FlightStatus).sort();

describe('flight status', () => {
    it('is the three the database admits', () => {
        expect(STATUSES).toEqual(['CANCELLED', 'DELAYED', 'ON_TIME']);
    });

    it('accepts exactly those at the request boundary', () => {
        expect([...flightStatusSchema.options].sort()).toEqual(STATUSES);
        expect(flightStatusSchema.safeParse('DIVERTED').success).toBe(false);
    });

    it('treats a cancelled flight as the one search hides', () => {
        // `searchFlightsAction` filters on this exact spelling, and it is now
        // the enum's rather than a loose string, so a rename would be caught
        // here as well as by the column.
        expect(STATUSES).toContain('CANCELLED');
        expect(FlightStatus.CANCELLED).toBe('CANCELLED');
    });

    it('derives FLIGHT_STATUSES from flightStatusSchema options without drift', () => {
        expect([...FLIGHT_STATUSES].sort()).toEqual(STATUSES);
    });

    it('maps all valid FlightStatus values to human-readable labels', () => {
        expect(flightStatusLabel('ON_TIME')).toBe('On Time');
        expect(flightStatusLabel('DELAYED')).toBe('Delayed');
        expect(flightStatusLabel('CANCELLED')).toBe('Cancelled');
    });

    it('provides styles for all valid FlightStatus values', () => {
        for (const status of FLIGHT_STATUSES) {
            const style = flightStatusStyle(status);
            expect(style).toHaveProperty('backgroundColor');
            expect(style).toHaveProperty('color');
            expect(style).toHaveProperty('border');
        }
    });
});
