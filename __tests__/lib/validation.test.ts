/** @jest-environment node */
import {
    bookingRequestSchema,
    cityGuideSchema,
    favoriteSchema,
    flightBookingServiceSchema,
    flightStatusSchema,
    InputValidationError,
    MAX_MUTATION_BYTES,
    occurrenceRequestSchema,
    parseInput,
    passengerSchema,
    registrationSchema,
    reviewSchema,
    scheduleSchema,
    searchFlightsSchema,
    seatChangesSchema
} from '@/lib/validation';

/**
 * A schedule must say how long its flight takes.
 *
 * It is required at three layers -- the form, this schema and a NOT NULL column
 * -- and was asserted at none, so every one of them could be relaxed with the
 * suite still green. Without it there is no arrival time, and the alternative
 * is the subtraction of local times #84 exists to remove.
 */
describe('a schedule states its flight duration', () => {
    const schedule = (durationMinutes: unknown) => ({
        flightNumber: 'MA900',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureTime: '08:00',
        durationMinutes,
        daysOfWeek: [1],
        price: '350',
    });

    it('accepts a plausible block time', () => {
        expect(scheduleSchema.safeParse(schedule(245)).success).toBe(true);
    });

    it('refuses a schedule with none', () => {
        const parsed = scheduleSchema.safeParse(schedule(undefined));

        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/duration is required/i);
    });

    it('refuses nothing, and refuses time running backwards', () => {
        for (const bad of [0, -5]) {
            const parsed = scheduleSchema.safeParse(schedule(bad));
            expect({ bad, ok: parsed.success }).toEqual({ bad, ok: false });
            expect(JSON.stringify(parsed.error?.issues)).toMatch(/at least one minute/i);
        }
    });

    it('refuses a number that is not whole minutes', () => {
        const parsed = scheduleSchema.safeParse(schedule(1.5));

        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/whole number of minutes/i);
    });

    it('refuses a duration longer than any sector, which catches a wrong unit', () => {
        // 99999 is what someone types when they meant seconds, or hours.
        const parsed = scheduleSchema.safeParse(schedule(99_999));

        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/shorter than three days/i);
    });
});

describe('shared server validation schemas', () => {
    afterEach(() => jest.useRealTimers());

    it('normalizes valid registration input', () => {
        expect(registrationSchema.parse({
            name: '  Ada Lovelace  ',
            email: '  ADA@Example.COM ',
            password: 'password123'
        })).toEqual({
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            password: 'password123'
        });
    });

    it('rejects malformed and oversized registration input', () => {
        expect(registrationSchema.safeParse({
            name: 'A'.repeat(101),
            email: 'not-an-email',
            password: 'short'
        }).success).toBe(false);
    });

    it('validates and normalizes reviews and favorite identifiers', () => {
        expect(reviewSchema.parse({ cityGuideId: 3, rating: 5, content: '  Great trip  ' }))
            .toEqual({ cityGuideId: 3, rating: 5, content: 'Great trip' });
        expect(reviewSchema.safeParse({ cityGuideId: 0, rating: 6, content: '' }).success)
            .toBe(false);
        expect(favoriteSchema.parse({ cityGuideId: 1 })).toEqual({ cityGuideId: 1 });
        expect(favoriteSchema.safeParse({ cityGuideId: 1.5 }).success).toBe(false);
    });

    it('enforces city-guide coordinate, text, image, and array limits', () => {
        expect(cityGuideSchema.parse({
            city: ' Paris ',
            country: ' France ',
            latlong: [48.85, 2.35],
            description: ' City of light ',
            highlights: [' Eiffel Tower '],
            coverImage: null
        })).toMatchObject({
            city: 'Paris',
            country: 'France',
            description: 'City of light',
            highlights: ['Eiffel Tower']
        });
        expect(cityGuideSchema.safeParse({
            city: 'Paris',
            country: 'France',
            latlong: [91, 2.35],
            description: 'Description',
            highlights: Array.from({ length: 21 }, () => 'Highlight')
        }).success).toBe(false);
    });

    it('validates schedules and rejects duplicate days or invalid layouts', () => {
        expect(scheduleSchema.parse({
            flightNumber: ' aa 101 ',
            airline: ' Example Air ',
            from: ' Seattle, USA ',
            to: ' Detroit, USA ',
            departureTime: '08:00',
            durationMinutes: 245,
            daysOfWeek: [5, 1],
            price: '$350',
            firstClassRows: 3,
            businessRows: 3,
            premiumEconomyRows: 4,
            economyRows: 20,
            seatPattern: ' abc-def '
        })).toMatchObject({
            flightNumber: 'AA101',
            airline: 'Example Air',
            daysOfWeek: [1, 5],
            seatPattern: 'ABC-DEF'
        });
        expect(scheduleSchema.safeParse({
            flightNumber: 'AA101', airline: 'Air', from: 'A', to: 'B',
            departureTime: '08:00', durationMinutes: 245, daysOfWeek: [1, 1], price: '$1'
        }).success).toBe(false);
    });

    it('validates passengers, dates, cabins, seats, and booking array limits', () => {
        const passenger = {
            firstName: ' Ada ',
            lastName: ' Lovelace ',
            dateOfBirth: '1990-01-02',
            passportNumber: ' ab123456 ',
            gender: 'Female',
            seatNumbers: ['11a'],
            cabinClass: 'ECONOMY'
        };
        expect(passengerSchema.parse(passenger)).toMatchObject({
            firstName: 'Ada',
            lastName: 'Lovelace',
            passportNumber: 'AB123456',
            seatNumbers: ['11A']
        });
        expect(passengerSchema.parse({
            ...passenger,
            dateOfBirth: '1990-01-02T00:00:00.000Z'
        }).dateOfBirth).toBe('1990-01-02');
        expect(passengerSchema.safeParse({
            ...passenger,
            dateOfBirth: '1990-01-02Tgarbage'
        }).success).toBe(false);
        expect(passengerSchema.safeParse({ ...passenger, dateOfBirth: '2999-01-01' }).success)
            .toBe(false);
        expect(bookingRequestSchema.safeParse({
            flightIds: [1],
            passengers: Array.from({ length: 9 }, () => passenger),
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        }).success).toBe(true);
        expect(bookingRequestSchema.safeParse({
            flightIds: [1],
            passengers: Array.from({ length: 10 }, () => passenger),
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        }).success).toBe(false);
        expect(flightBookingServiceSchema.safeParse({
            flightIds: [1],
            userId: 'user-1',
            passengers: [passenger],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        }).success).toBe(true);
        expect(flightBookingServiceSchema.safeParse({ flightIds: [1], userId: '' }).success)
            .toBe(false);
    });

    it('validates occurrence dates, ranges, identifiers, and override shapes', () => {
        expect(occurrenceRequestSchema.parse({
            scheduleId: 2,
            startDate: '2026-07-01',
            endDate: '2026-07-31',
            seatingConfig: { economyRows: 22, seatPattern: 'ABC-DEF' }
        })).toMatchObject({ scheduleId: 2, startDate: '2026-07-01' });
        expect(occurrenceRequestSchema.safeParse({
            scheduleId: 0,
            startDate: '07/01/2026',
            endDate: '2027-07-31',
            seatingConfig: { unknown: true }
        }).success).toBe(false);
    });

    it('validates seat changes and rejects duplicate passengers or seats', () => {
        expect(seatChangesSchema.parse({
            bookingId: 2,
            seatChanges: [{ passengerId: ' passenger-1 ', legId: 7, seatNumber: '12b' }]
        })).toEqual({
            bookingId: 2,
            seatChanges: [{ passengerId: 'passenger-1', legId: 7, seatNumber: '12B' }]
        });
        // Two travellers cannot share a seat on the same leg.
        expect(seatChangesSchema.safeParse({
            bookingId: 2,
            seatChanges: [
                { passengerId: 'p1', legId: 7, seatNumber: '12A' },
                { passengerId: 'p2', legId: 7, seatNumber: '12A' }
            ]
        }).success).toBe(false);
        // Nor can one traveller be given two seats on the same leg.
        expect(seatChangesSchema.safeParse({
            bookingId: 2,
            seatChanges: [
                { passengerId: 'p1', legId: 7, seatNumber: '12A' },
                { passengerId: 'p1', legId: 7, seatNumber: '12B' }
            ]
        }).success).toBe(false);
        // The same seat number on two legs is two different flights, so it is
        // not a clash and must be accepted.
        expect(seatChangesSchema.safeParse({
            bookingId: 2,
            seatChanges: [
                { passengerId: 'p1', legId: 7, seatNumber: '12A' },
                { passengerId: 'p1', legId: 8, seatNumber: '12A' }
            ]
        }).success).toBe(true);
        // A change must say which leg it applies to.
        expect(seatChangesSchema.safeParse({
            bookingId: 2,
            seatChanges: [{ passengerId: 'p1', seatNumber: '12A' }]
        }).success).toBe(false);
    });

    it('throws structured customer-safe errors and enforces mutation byte limits', () => {
        expect(() => parseInput(favoriteSchema, { cityGuideId: -1 })).toThrow(InputValidationError);
        try {
            parseInput(favoriteSchema, { cityGuideId: -1 });
        } catch (error) {
            expect(error).toMatchObject({
                code: 'VALIDATION_ERROR'
            });
            expect((error as InputValidationError).fields).toHaveProperty('cityGuideId');
        }

        expect(() => parseInput(
            cityGuideSchema,
            { padding: 'x'.repeat(MAX_MUTATION_BYTES) }
        )).toThrow('Request is too large.');
    });

    it('covers exact registration, review, and search boundaries', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));

        expect(registrationSchema.safeParse({
            name: 'N'.repeat(100), email: 'a@example.com', password: 'p'.repeat(128)
        }).success).toBe(true);
        expect(registrationSchema.safeParse({
            name: 'N'.repeat(101), email: 'a@example.com', password: 'p'.repeat(129)
        }).success).toBe(false);
        expect(registrationSchema.safeParse({
            name: 'Ada', email: 'a@example.com', password: 'password', extra: true
        }).success).toBe(false);

        expect(reviewSchema.safeParse({ cityGuideId: 1, rating: 1, content: 'x'.repeat(2_000) }).success).toBe(true);
        expect(reviewSchema.safeParse({ cityGuideId: 1, rating: 5, content: 'x'.repeat(2_001) }).success).toBe(false);
        expect(reviewSchema.safeParse({ cityGuideId: '1', rating: 3, content: 'Review' }).success).toBe(false);

        expect(searchFlightsSchema.parse({
            from: ` ${'A'.repeat(120)} `, to: ' B ', departureDate: '2026-06-25'
        })).toEqual({ from: 'A'.repeat(120), to: 'B', departureDate: '2026-06-25', cabinClass: 'ECONOMY' });
        expect(searchFlightsSchema.safeParse({ from: 'A'.repeat(121), to: '', departureDate: '06/25/2026' }).success).toBe(false);
        expect(searchFlightsSchema.safeParse({ from: 'A', to: 'B', unknown: true }).success).toBe(false);
        // A cabin the airline does not sell must not fall through to economy.
        expect(searchFlightsSchema.safeParse({ from: 'A', to: 'B', cabinClass: 'SLEEPER' }).success).toBe(false);
        expect(searchFlightsSchema.parse({ from: 'A', to: 'B', cabinClass: 'FIRST' }).cabinClass).toBe('FIRST');
    });

    it('rejects past departures and returns before departure', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

        const pastDeparture = searchFlightsSchema.safeParse({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-07-13',
        });
        const invalidReturn = searchFlightsSchema.safeParse({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-07-15',
            returnDate: '2026-07-14',
        });

        expect(pastDeparture.error?.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: ['departureDate'],
                message: 'Departure date cannot be in the past.',
            }),
        ]));
        expect(invalidReturn.error?.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: ['returnDate'],
                message: 'Return date cannot be before departure date.',
            }),
        ]));
    });

    it('requires a departure date when a return date is provided', () => {
        const returnWithoutDeparture = searchFlightsSchema.safeParse({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            returnDate: '2026-07-20',
        });

        expect(returnWithoutDeparture.error?.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: ['departureDate'],
                message: 'Departure date is required when a return date is provided.',
            }),
        ]));
    });

    it('accepts the booking-window boundary and rejects later travel', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

        expect(searchFlightsSchema.safeParse({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2027-07-14',
            returnDate: '2027-07-14',
        }).success).toBe(true);

        const lateDeparture = searchFlightsSchema.safeParse({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2027-07-15',
        });
        const lateReturn = searchFlightsSchema.safeParse({
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2027-07-14',
            returnDate: '2027-07-15',
        });

        expect(lateDeparture.error?.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: ['departureDate'],
                message: 'Departure date cannot be more than 365 days in advance.',
            }),
        ]));
        expect(lateReturn.error?.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: ['returnDate'],
                message: 'Return date cannot be more than 365 days in advance.',
            }),
        ]));
    });

    it('accepts a fare in the form the edit form seeds it', () => {
        // The edit form fills this field with formatPrice output, which uses
        // thousands separators. Rejecting that would make a schedule
        // impossible to re-save without editing the price (#135).
        const base = {
            flightNumber: 'MA1', airline: 'A', from: 'X', to: 'Y',
            departureTime: '08:00', durationMinutes: 245, daysOfWeek: [1],
        };
        expect(scheduleSchema.safeParse({ ...base, price: '$1,234.56' }).success).toBe(true);
        expect(scheduleSchema.safeParse({ ...base, price: '$1234' }).success).toBe(true);
        expect(scheduleSchema.safeParse({ ...base, price: '$1,23' }).success).toBe(false);
    });

    it('covers exact city-guide and schedule boundaries', () => {
        const imagePrefix = 'data:image/png;base64,';
        const boundaryGuide = {
            city: 'C'.repeat(100),
            country: 'K'.repeat(100),
            latlong: [-90, 180],
            description: 'D'.repeat(5_000),
            highlights: Array.from({ length: 20 }, () => 'H'.repeat(200)),
            coverImage: imagePrefix + 'a'.repeat(750_000 - imagePrefix.length)
        };
        expect(cityGuideSchema.safeParse(boundaryGuide).success).toBe(true);
        expect(cityGuideSchema.safeParse({ ...boundaryGuide, description: 'D'.repeat(5_001) }).success).toBe(false);
        expect(cityGuideSchema.safeParse({ ...boundaryGuide, highlights: [...boundaryGuide.highlights, 'extra'] }).success).toBe(false);
        expect(cityGuideSchema.safeParse({ ...boundaryGuide, coverImage: boundaryGuide.coverImage + 'a' }).success).toBe(false);
        expect(cityGuideSchema.safeParse({ ...boundaryGuide, latlong: ['north', 180] }).success).toBe(false);

        const boundarySchedule = {
            flightNumber: 'AB12345678', airline: 'A'.repeat(120), from: 'F'.repeat(120), to: 'T'.repeat(120),
            departureTime: '23:59', durationMinutes: 245, daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            price: '$999999', firstClassRows: 0, businessRows: 0,
            premiumEconomyRows: 0, economyRows: 1, seatPattern: 'ABCDEFGHIJKL'
        };
        expect(scheduleSchema.safeParse(boundarySchedule).success).toBe(true);
        expect(scheduleSchema.safeParse({ ...boundarySchedule, airline: 'A'.repeat(121) }).success).toBe(false);
        expect(scheduleSchema.safeParse({ ...boundarySchedule, daysOfWeek: [...boundarySchedule.daysOfWeek, 0] }).success).toBe(false);
        expect(scheduleSchema.safeParse({ ...boundarySchedule, seatPattern: 'ABCDEFGHIJKLM' }).success).toBe(false);
        expect(scheduleSchema.safeParse({ ...boundarySchedule, departureTime: 1200 }).success).toBe(false);
    });

    it('covers exact passenger, booking, seat-change, occurrence, and enum boundaries', () => {
        const passenger = {
            firstName: 'F'.repeat(100), lastName: 'L'.repeat(100), dateOfBirth: '1900-01-01',
            passportNumber: 'P'.repeat(32), gender: 'Other', seatNumbers: ['999A'], cabinClass: 'FIRST'
        };
        expect(passengerSchema.safeParse(passenger).success).toBe(true);
        expect(passengerSchema.safeParse({ ...passenger, firstName: 'F'.repeat(101) }).success).toBe(false);
        expect(passengerSchema.safeParse({ ...passenger, gender: 'Unknown' }).success).toBe(false);
        expect(passengerSchema.safeParse({ ...passenger, extra: true }).success).toBe(false);

        const passengers = Array.from({ length: 9 }, (_, index) => ({
            ...passenger, passportNumber: `P${index}`, seatNumbers: [`${index + 1}A`]
        }));
        const idempotencyKey = '8ea59a65-9251-45b3-95d0-3920c49f5735';
        expect(bookingRequestSchema.safeParse({ flightIds: [1], passengers, idempotencyKey }).success).toBe(true);
        expect(bookingRequestSchema.safeParse({ flightIds: [1], passengers: [], idempotencyKey }).success).toBe(false);
        expect(bookingRequestSchema.safeParse({ flightIds: [1], passengers: [...passengers, passenger], idempotencyKey }).success).toBe(false);
        expect(bookingRequestSchema.safeParse({
            flightIds: [1],
            passengers,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        }).success).toBe(true);
        expect(bookingRequestSchema.safeParse({
            flightIds: [1],
            passengers,
            idempotencyKey: 'not-a-uuid'
        }).success).toBe(false);
        expect(bookingRequestSchema.safeParse({
            flightIds: [1],
            passengers,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPrice: '$1',
            paymentIntentId: 'forged'
        }).success).toBe(false);

        // A full booking changing every seat on every leg: 9 travellers on each
        // of 2 legs is the largest legitimate request.
        const seatChanges = [1, 2].flatMap(legId =>
            Array.from({ length: 9 }, (_, index) => ({
                passengerId: `p${index}`,
                legId,
                seatNumber: `${index + 1}A`,
            }))
        );
        expect(seatChanges).toHaveLength(18);
        expect(seatChangesSchema.safeParse({ bookingId: 1, seatChanges }).success).toBe(true);
        expect(seatChangesSchema.safeParse({
            bookingId: 1,
            seatChanges: [...seatChanges, { passengerId: 'p9', legId: 1, seatNumber: '10A' }]
        }).success).toBe(false);
        expect(seatChangesSchema.safeParse({ bookingId: '1', seatChanges }).success).toBe(false);

        expect(occurrenceRequestSchema.safeParse({ scheduleId: 1, startDate: '2026-01-01', endDate: '2027-01-02' }).success).toBe(true);
        expect(occurrenceRequestSchema.safeParse({ scheduleId: 1, startDate: '2026-01-01', endDate: '2027-01-03' }).success).toBe(false);
        expect(flightStatusSchema.safeParse('CANCELLED').success).toBe(true);
        expect(flightStatusSchema.safeParse('BOARDING').success).toBe(false);
    });
});
