/** @jest-environment node */
import {
    accountTimeZoneSchema,
    ancillaryTypeSchema,
    bookingAncillariesMapSchema,
    passengerAncillariesSchema,
    bookingRequestSchema,
    cityGuideSchema,
    checkoutPaymentRequestSchema,
    favoriteSchema,
    flightBookingServiceSchema,
    flightStatusSchema,
    InputValidationError,
    MAX_ITINERARY_LEGS,
    MAX_MUTATION_BYTES,
    multiCityLegSchema,
    occurrenceRequestSchema,
    parseInput,
    passengerSchema,
    registrationSchema,
    reviewSchema,
    rebookItineraryRequestSchema,
    scheduleSchema,
    flightScheduleTermsSchema,
    searchFlightsSchema,
    seatChangesSchema,
    airportIataCodeSchema,
    flightStatusSearchSchema,
    ktnSchema,
    redressNumberSchema,
    emergencyContactSchema,
    notificationCategoryEnum,
    notificationChannelEnum,
    notificationDeliveryStatusEnum,
    notificationPreferenceItemSchema,
    updateNotificationPreferencesSchema,
    adminNotificationDeliveriesQuerySchema,
    searchMultiCityFlightsSchema
} from '@/lib/validation';

describe('account timezone validation', () => {
    it('stores a recognized IANA timezone canonically', () => {
        expect(accountTimeZoneSchema.parse(' US/Pacific ')).toBe('America/Los_Angeles');
    });

    it.each(['', 'Not/AZone'])('rejects %j', value => {
        expect(accountTimeZoneSchema.safeParse(value).success).toBe(false);
    });

    it('rejects one character past the persisted timezone limit for that reason', () => {
        const result = accountTimeZoneSchema.safeParse('x'.repeat(101));

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.map(issue => issue.message))
                .toEqual(['Timezone is too long.']);
        }
    });
});

describe('customer rebooking request integrity', () => {
    const valid = {
        bookingId: 42,
        replacements: [{
            fromLegId: 501,
            replacementFlightId: 901,
            seats: [
                { passengerId: 'passenger-a', seatNumber: ' 14a ' },
                { passengerId: 'passenger-b', seatNumber: '14B' },
            ],
        }],
    };

    it('normalizes a complete replacement request', () => {
        expect(rebookItineraryRequestSchema.parse(valid)).toEqual({
            ...valid,
            replacements: [{
                ...valid.replacements[0],
                seats: [
                    { passengerId: 'passenger-a', seatNumber: '14A' },
                    { passengerId: 'passenger-b', seatNumber: '14B' },
                ],
            }],
        });
    });

    it('accepts the exact itinerary and passenger limits, then rejects one past each', () => {
        const seats = Array.from({ length: 9 }, (_, index) => ({
            passengerId: `passenger-${index}`,
            seatNumber: `${index + 1}A`,
        }));
        const atLimit = {
            bookingId: 42,
            replacements: [
                { fromLegId: 501, replacementFlightId: 901, seats },
                { fromLegId: 502, replacementFlightId: 902, seats },
                { fromLegId: 503, replacementFlightId: 903, seats },
                { fromLegId: 504, replacementFlightId: 904, seats },
                { fromLegId: 505, replacementFlightId: 905, seats },
            ],
        };
        expect(rebookItineraryRequestSchema.safeParse(atLimit).success).toBe(true);
        expect(rebookItineraryRequestSchema.safeParse({
            ...atLimit,
            replacements: [{
                ...atLimit.replacements[0],
                seats: [...seats, { passengerId: 'passenger-9', seatNumber: '10A' }],
            }],
        }).success).toBe(false);
        expect(rebookItineraryRequestSchema.safeParse({
            ...atLimit,
            replacements: [...atLimit.replacements, {
                fromLegId: 506,
                replacementFlightId: 906,
                seats,
            }],
        }).success).toBe(false);
    });

    it('rejects empty and unknown nested replacement fields', () => {
        expect(rebookItineraryRequestSchema.safeParse({
            bookingId: 42,
            replacements: [],
        }).success).toBe(false);
        expect(rebookItineraryRequestSchema.safeParse({
            ...valid,
            replacements: [{ ...valid.replacements[0], clientApproved: true }],
        }).success).toBe(false);
        expect(rebookItineraryRequestSchema.safeParse({
            ...valid,
            replacements: [{
                ...valid.replacements[0],
                seats: [{ ...valid.replacements[0].seats[0], cabinClass: 'FIRST' }],
            }],
        }).success).toBe(false);
    });

    it.each([
        ['an unknown top-level field', { ...valid, actorUserId: 'forged' }],
        ['a repeated cancelled leg', {
            ...valid,
            replacements: [valid.replacements[0], {
                ...valid.replacements[0],
                replacementFlightId: 902,
            }],
        }],
        ['a repeated replacement flight', {
            ...valid,
            replacements: [valid.replacements[0], {
                ...valid.replacements[0],
                fromLegId: 502,
            }],
        }],
        ['a repeated passenger on one leg', {
            ...valid,
            replacements: [{
                ...valid.replacements[0],
                seats: [valid.replacements[0].seats[0], {
                    ...valid.replacements[0].seats[0],
                    seatNumber: '14C',
                }],
            }],
        }],
        ['a repeated seat on one leg', {
            ...valid,
            replacements: [{
                ...valid.replacements[0],
                seats: [valid.replacements[0].seats[0], {
                    passengerId: 'passenger-b',
                    seatNumber: '14A',
                }],
            }],
        }],
    ])('rejects %s', (_name, input) => {
        expect(rebookItineraryRequestSchema.safeParse(input).success).toBe(false);
    });
});

describe('checkout payment request integrity', () => {
    const checkoutId = '8ea59a65-9251-45b3-95d0-3920c49f5735';
    const valid = {
        checkoutId,
        flightIds: [41, 42],
        passengers: [
            { seatNumbers: ['2A', '2A'], cabinClass: 'BUSINESS' },
            { seatNumbers: ['2B', '2B'], cabinClass: 'BUSINESS' },
        ],
    };

    it('accepts one seat per traveller and leg', () => {
        expect(checkoutPaymentRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects a repeated flight', () => {
        expect(checkoutPaymentRequestSchema.safeParse({
            ...valid,
            flightIds: [41, 41],
        }).success).toBe(false);
    });

    it('rejects a traveller without one seat per leg', () => {
        expect(checkoutPaymentRequestSchema.safeParse({
            ...valid,
            passengers: [{ seatNumbers: ['2A'], cabinClass: 'BUSINESS' }],
        }).success).toBe(false);
    });

    it('rejects two travellers claiming the same seat on one flight', () => {
        expect(checkoutPaymentRequestSchema.safeParse({
            ...valid,
            passengers: [
                valid.passengers[0],
                { seatNumbers: ['2A', '2B'], cabinClass: 'BUSINESS' },
            ],
        }).success).toBe(false);
    });
});

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

    it('binds schedule term updates to an explicit confirmed UUID request', () => {
        const update = {
            requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            flightScheduleId: 17,
            durationMinutes: 4320,
            price: '$1,234.56',
            confirmed: true,
        };

        expect(flightScheduleTermsSchema.safeParse(update).success).toBe(true);
        expect(flightScheduleTermsSchema.safeParse({ ...update, requestId: 'not-a-uuid' }).success).toBe(false);
        expect(flightScheduleTermsSchema.safeParse({ ...update, confirmed: false }).success).toBe(false);
        expect(flightScheduleTermsSchema.safeParse({ ...update, durationMinutes: 4321 }).success).toBe(false);
        expect(flightScheduleTermsSchema.safeParse({ ...update, flightScheduleId: 0 }).success).toBe(false);
        expect(flightScheduleTermsSchema.safeParse({ ...update, extra: true }).success).toBe(false);
    });

    it('covers exact city-guide and schedule boundaries', () => {
        const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const boundaryPng = Buffer.concat([pngHeader, Buffer.alloc(512_000 - pngHeader.length)]);
        const boundaryGuide = {
            city: 'C'.repeat(100),
            country: 'K'.repeat(100),
            latlong: [-90, 180],
            description: 'D'.repeat(5_000),
            highlights: Array.from({ length: 20 }, () => 'H'.repeat(200)),
            coverImage: `data:image/png;base64,${boundaryPng.toString('base64')}`
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
        // of 5 legs is the largest legitimate request.
        const seatChanges = [1, 2, 3, 4, 5].flatMap(legId =>
            Array.from({ length: 9 }, (_, index) => ({
                passengerId: `p${index}`,
                legId,
                seatNumber: `${index + 1}A`,
            }))
        );
        expect(seatChanges).toHaveLength(45);
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

describe('passenger ancillaries validation', () => {
    it('accepts valid ancillary selection', () => {
        const parsed = passengerAncillariesSchema.safeParse(['CARRY_ON', 'CHECKED_BAG_1', 'PRIORITY_BOARDING']);
        expect(parsed.success).toBe(true);
    });

    it('rejects 2nd checked bag if 1st checked bag is not selected', () => {
        const parsed = passengerAncillariesSchema.safeParse(['CHECKED_BAG_2']);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.issues[0].message).toMatch(/first checked bag must be selected/i);
        }
    });

    it('rejects duplicate ancillary types for a single passenger', () => {
        const parsed = passengerAncillariesSchema.safeParse(['CHECKED_BAG_1', 'CHECKED_BAG_1']);
        expect(parsed.success).toBe(false);
    });

    it('validates ancillaryTypeSchema values', () => {
        expect(ancillaryTypeSchema.safeParse('CARRY_ON').success).toBe(true);
        expect(ancillaryTypeSchema.safeParse('CHECKED_BAG_1').success).toBe(true);
        expect(ancillaryTypeSchema.safeParse('CHECKED_BAG_2').success).toBe(true);
        expect(ancillaryTypeSchema.safeParse('PRIORITY_BOARDING').success).toBe(true);
        expect(ancillaryTypeSchema.safeParse('SPECIAL_ASSISTANCE').success).toBe(true);
        expect(ancillaryTypeSchema.safeParse('EXTRA_LEG_ROOM').success).toBe(false);
    });

    it('validates bookingAncillariesMapSchema', () => {
        const validMap = {
            '0': ['CARRY_ON', 'CHECKED_BAG_1'],
            '1': ['SPECIAL_ASSISTANCE'],
        };
        expect(bookingAncillariesMapSchema.safeParse(validMap).success).toBe(true);

        const invalidMap = {
            '0': ['CHECKED_BAG_2'],
        };
        expect(bookingAncillariesMapSchema.safeParse(invalidMap).success).toBe(false);
    });
});

describe('flightStatusSearchSchema', () => {
    it('validates search by flight number', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: 'MA101',
            date: '2026-07-15',
        });
        expect(parsed.success).toBe(true);
    });

    it('validates search by flight number without date', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: 'MA101',
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects flight number shorter than 2 characters or longer than 10 characters', () => {
        const tooShort = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: 'M',
        });
        expect(tooShort.success).toBe(false);

        const tooLong = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: 'MA123456789',
        });
        expect(tooLong.success).toBe(false);
    });

    it('validates search by route', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'SEA',
            to: 'DTW',
            date: '2026-07-15',
        });
        expect(parsed.success).toBe(true);
    });

    it('validates search by route without date', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'SEA',
            to: 'DTW',
        });
        expect(parsed.success).toBe(true);
    });

    it('rejects identical origin and destination airports', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'SEA',
            to: 'SEA',
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.issues[0].message).toBe('Origin and destination must be different.');
        }
    });

    it('rejects identical origin and destination airports ignoring case', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'sea',
            to: 'SEA',
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects invalid airport codes', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: 'SE',
            to: 'DTW1',
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects invalid date format', () => {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: 'MA101',
            date: '2026/07/15',
        });
        expect(parsed.success).toBe(false);
    });
});

describe('passenger security and emergency contact validation', () => {
    describe('ktnSchema', () => {
        it('accepts valid 9-character alphanumeric KTN and normalizes to uppercase', () => {
            expect(ktnSchema.parse('123456789')).toBe('123456789');
            expect(ktnSchema.parse(' abc123456 ')).toBe('ABC123456');
            expect(ktnSchema.parse('987654321')).toBe('987654321');
        });

        it('accepts optional / empty / undefined / null values', () => {
            expect(ktnSchema.parse(undefined)).toBeUndefined();
            expect(ktnSchema.parse('')).toBeUndefined();
            expect(ktnSchema.parse(null)).toBeUndefined();
        });

        it('rejects KTN that is not 9 characters or contains invalid characters', () => {
            expect(ktnSchema.safeParse('12345678').success).toBe(false);
            expect(ktnSchema.safeParse('1234567890').success).toBe(false);
            expect(ktnSchema.safeParse('ABC12345!').success).toBe(false);
            expect(ktnSchema.safeParse('ABC-12345').success).toBe(false);
        });
    });

    describe('redressNumberSchema', () => {
        it('accepts valid 7-digit numeric string', () => {
            expect(redressNumberSchema.parse('1234567')).toBe('1234567');
            expect(redressNumberSchema.parse(' 7654321 ')).toBe('7654321');
        });

        it('accepts optional / empty / undefined / null values', () => {
            expect(redressNumberSchema.parse(undefined)).toBeUndefined();
            expect(redressNumberSchema.parse('')).toBeUndefined();
            expect(redressNumberSchema.parse(null)).toBeUndefined();
        });

        it('rejects redress numbers that are not exactly 7 digits or contain non-digits', () => {
            expect(redressNumberSchema.safeParse('123456').success).toBe(false);
            expect(redressNumberSchema.safeParse('12345678').success).toBe(false);
            expect(redressNumberSchema.safeParse('123456A').success).toBe(false);
            expect(redressNumberSchema.safeParse('123-456').success).toBe(false);
        });
    });

    describe('emergencyContactSchema', () => {
        it('accepts valid emergency contact object', () => {
            const valid = {
                name: 'Jane Doe',
                relationship: 'Spouse',
                phone: '+1 (555) 123-4567',
            };
            expect(emergencyContactSchema.parse(valid)).toEqual(valid);
        });

        it('accepts optional / empty / undefined / null values', () => {
            expect(emergencyContactSchema.parse(undefined)).toBeUndefined();
            expect(emergencyContactSchema.parse(null)).toBeUndefined();
            expect(emergencyContactSchema.parse({})).toBeUndefined();
            expect(emergencyContactSchema.parse({ name: '', relationship: '', phone: '' })).toBeUndefined();
        });

        it('rejects emergency contact with missing required fields when provided', () => {
            expect(emergencyContactSchema.safeParse({ name: 'Jane Doe' }).success).toBe(false);
            expect(emergencyContactSchema.safeParse({ name: 'Jane Doe', relationship: 'Spouse' }).success).toBe(false);
            expect(emergencyContactSchema.safeParse({
                name: 'Jane Doe',
                relationship: 'Spouse',
                phone: 'abc',
            }).success).toBe(false);
        });
    });

    describe('passengerSchema security fields integration', () => {
        const basePassenger = {
            firstName: 'Ada',
            lastName: 'Lovelace',
            dateOfBirth: '1990-01-01',
            passportNumber: 'AB123456',
            gender: 'Female',
            seatNumbers: ['11A'],
            cabinClass: 'ECONOMY',
        };

        it('accepts passenger with KTN, Redress, and Emergency Contact', () => {
            const withSecurity = {
                ...basePassenger,
                ktn: '123456789',
                redressNumber: '1234567',
                emergencyContact: {
                    name: 'Charles Babbage',
                    relationship: 'Colleague',
                    phone: '+1 555-0100',
                },
            };
            const result = passengerSchema.safeParse(withSecurity);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.ktn).toBe('123456789');
                expect(result.data.redressNumber).toBe('1234567');
                expect(result.data.emergencyContact).toEqual({
                    name: 'Charles Babbage',
                    relationship: 'Colleague',
                    phone: '+1 555-0100',
                });
            }
        });

        it('accepts passenger without security fields (optionality preserved)', () => {
            const result = passengerSchema.safeParse(basePassenger);
            expect(result.success).toBe(true);
        });

        it('rejects passenger with invalid KTN', () => {
            expect(passengerSchema.safeParse({
                ...basePassenger,
                ktn: 'short',
            }).success).toBe(false);
        });

        it('rejects passenger with invalid Redress Number', () => {
            expect(passengerSchema.safeParse({
                ...basePassenger,
                redressNumber: '123',
            }).success).toBe(false);
        });

        it('rejects passenger with invalid Emergency Contact phone', () => {
            expect(passengerSchema.safeParse({
                ...basePassenger,
                emergencyContact: {
                    name: 'Charles',
                    relationship: 'Friend',
                    phone: 'invalid',
                },
            }).success).toBe(false);
        });
    });

    describe('cityGuideSchema coverImage upload validation', () => {
        const baseGuide = {
            city: 'Tokyo',
            country: 'Japan',
            latlong: [35.6762, 139.6503] as [number, number],
            description: 'Vibrant capital of Japan.',
            highlights: ['Shinjuku', 'Shibuya', 'Asakusa'],
        };

        const sampleJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
        const samplePng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
        const sampleWebp = Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
        ]);
        const sampleAvif = Buffer.from([
            0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70,
            0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
        ]);

        it('accepts allowed local static paths (/img/...) and managed uploads', () => {
            const staticResult = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: '/img/my-profile-photo.jpg',
            });
            expect(staticResult.success).toBe(true);

            const managedResult = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: '/uploads/guides/guide-1234567890abcdef.png',
            });
            expect(managedResult.success).toBe(true);
        });

        it('rejects unmanaged external https:// URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: 'https://images.example.com/destinations/tokyo.png',
            });
            expect(result.success).toBe(false);
        });

        it('accepts valid PNG data URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/png;base64,${samplePng.toString('base64')}`,
            });
            expect(result.success).toBe(true);
        });

        it('accepts valid JPEG data URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/jpeg;base64,${sampleJpeg.toString('base64')}`,
            });
            expect(result.success).toBe(true);
        });

        it('accepts valid WebP data URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/webp;base64,${sampleWebp.toString('base64')}`,
            });
            expect(result.success).toBe(true);
        });

        it('accepts valid AVIF data URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/avif;base64,${sampleAvif.toString('base64')}`,
            });
            expect(result.success).toBe(true);
        });

        it('rejects insecure http:// URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: 'http://images.example.com/tokyo.jpg',
            });
            expect(result.success).toBe(false);
        });

        it('rejects javascript: and other URI schemes', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: 'javascript:alert(1)',
            });
            expect(result.success).toBe(false);
        });

        it('rejects SVG data URLs', () => {
            const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+';
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: svgDataUrl,
            });
            expect(result.success).toBe(false);
        });

        it('rejects oversized data URLs (> 500 KB)', () => {
            const oversized = Buffer.concat([samplePng, Buffer.alloc(512_001)]);
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/png;base64,${oversized.toString('base64')}`,
            });
            expect(result.success).toBe(false);
        });

        it('rejects corrupted base64 data URLs', () => {
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: 'data:image/png;base64,not-valid-base64!',
            });
            expect(result.success).toBe(false);
        });

        it('rejects MIME type vs magic byte mismatches', () => {
            // Declared JPEG but PNG payload
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/jpeg;base64,${samplePng.toString('base64')}`,
            });
            expect(result.success).toBe(false);
        });

        it('rejects polyglot image payloads containing script tags', () => {
            const polyglot = Buffer.concat([samplePng, Buffer.from('<script>alert("polyglot")</script>')]);
            const result = cityGuideSchema.safeParse({
                ...baseGuide,
                coverImage: `data:image/png;base64,${polyglot.toString('base64')}`,
            });
            expect(result.success).toBe(false);
        });
    });
});

describe('notification validation schemas', () => {
    it('validates notificationCategoryEnum values', () => {
        expect(notificationCategoryEnum.safeParse('FLIGHT_STATUS').success).toBe(true);
        expect(notificationCategoryEnum.safeParse('ACCOUNT_ACTIVITY').success).toBe(true);
        expect(notificationCategoryEnum.safeParse('TRAVEL_GUIDES').success).toBe(true);
        expect(notificationCategoryEnum.safeParse('PROMOTIONS').success).toBe(false);
    });

    it('validates notificationChannelEnum values', () => {
        expect(notificationChannelEnum.safeParse('IN_APP').success).toBe(true);
        expect(notificationChannelEnum.safeParse('EMAIL').success).toBe(true);
        expect(notificationChannelEnum.safeParse('SMS').success).toBe(false);
    });

    it('validates notificationDeliveryStatusEnum values', () => {
        expect(notificationDeliveryStatusEnum.safeParse('PENDING').success).toBe(true);
        expect(notificationDeliveryStatusEnum.safeParse('SENT').success).toBe(true);
        expect(notificationDeliveryStatusEnum.safeParse('FAILED').success).toBe(true);
        expect(notificationDeliveryStatusEnum.safeParse('DELIVERED').success).toBe(false);
    });

    it('validates notificationPreferenceItemSchema', () => {
        expect(notificationPreferenceItemSchema.safeParse({
            category: 'FLIGHT_STATUS',
            channel: 'IN_APP',
            enabled: true,
        }).success).toBe(true);

        expect(notificationPreferenceItemSchema.safeParse({
            category: 'INVALID',
            channel: 'IN_APP',
            enabled: true,
        }).success).toBe(false);

        expect(notificationPreferenceItemSchema.safeParse({
            category: 'FLIGHT_STATUS',
            channel: 'IN_APP',
            enabled: 'yes',
        }).success).toBe(false);
    });

    it('validates updateNotificationPreferencesSchema', () => {
        expect(updateNotificationPreferencesSchema.safeParse([
            { category: 'FLIGHT_STATUS', channel: 'IN_APP', enabled: true },
            { category: 'TRAVEL_GUIDES', channel: 'EMAIL', enabled: false },
        ]).success).toBe(true);

        // Min 1 required
        expect(updateNotificationPreferencesSchema.safeParse([]).success).toBe(false);

        // Max 10 allowed
        const elevenItems = Array(11).fill({
            category: 'FLIGHT_STATUS',
            channel: 'IN_APP',
            enabled: true,
        });
        expect(updateNotificationPreferencesSchema.safeParse(elevenItems).success).toBe(false);
    });

    it('validates adminNotificationDeliveriesQuerySchema with defaults and bounds', () => {
        const parsedDefault = adminNotificationDeliveriesQuerySchema.parse({});
        expect(parsedDefault).toEqual({
            page: 1,
            pageSize: 25,
        });

        const parsedCustom = adminNotificationDeliveriesQuerySchema.parse({
            status: 'FAILED',
            channel: 'EMAIL',
            page: '3',
            pageSize: '50',
            search: 'flight',
        });
        expect(parsedCustom).toEqual({
            status: 'FAILED',
            channel: 'EMAIL',
            page: 3,
            pageSize: 50,
            search: 'flight',
        });

        // Rejects page < 1
        expect(adminNotificationDeliveriesQuerySchema.safeParse({ page: 0 }).success).toBe(false);
        // Rejects pageSize > 100
        expect(adminNotificationDeliveriesQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
});

describe('multi-city itinerary validation', () => {
    it('sets MAX_ITINERARY_LEGS to 5', () => {
        expect(MAX_ITINERARY_LEGS).toBe(5);
    });

    it('accepts a valid 3-leg multi-city search with ordered dates', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2026-07-05' },
                { from: 'New York, USA', to: 'Seattle, USA', departureDate: '2026-07-10' },
            ],
            cabinClass: 'ECONOMY',
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
    });

    it('refuses multi-city search with fewer than 2 legs', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-01' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/at least 2 legs/i);
    });

    it('refuses multi-city search with more than 5 legs', () => {
        const payload = {
            legs: Array.from({ length: 6 }, (_, i) => ({
                from: `City ${i}`,
                to: `City ${i + 1}`,
                departureDate: '2026-07-01',
            })),
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/at most 5 legs/i);
    });

    it('refuses a leg where origin and destination are identical', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Seattle, USA', departureDate: '2026-07-01' },
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-05' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/origin and destination must be different/i);
    });

    it('refuses non-sequential departure dates where a later leg departs earlier than an earlier leg', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2026-07-10' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2026-07-05' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.error?.issues)).toMatch(/cannot be earlier than/i);
    });

    it('accepts future flight dates in subsequent years', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2027-03-01' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2027-03-05' },
            ],
            cabinClass: 'BUSINESS',
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
    });

    it('accepts same-day departure dates across consecutive legs', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2027-04-10' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2027-04-10' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
    });

    it('accepts exactly 2 legs at the lower boundary', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2027-05-01' },
                { from: 'Detroit, USA', to: 'New York, USA', departureDate: '2027-05-03' },
            ],
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
    });

    it('accepts exactly 5 legs at the upper boundary (MAX_ITINERARY_LEGS)', () => {
        const payload = {
            legs: [
                { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2027-06-01' },
                { from: 'Detroit, USA', to: 'Chicago, USA', departureDate: '2027-06-03' },
                { from: 'Chicago, USA', to: 'Denver, USA', departureDate: '2027-06-05' },
                { from: 'Denver, USA', to: 'San Francisco, USA', departureDate: '2027-06-07' },
                { from: 'San Francisco, USA', to: 'Seattle, USA', departureDate: '2027-06-10' },
            ],
            cabinClass: 'PREMIUM_ECONOMY',
        };
        const parsed = searchMultiCityFlightsSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
    });

    it('validates a single multi-city leg with valid future date and differing endpoints', () => {
        const leg = { from: 'Seattle, USA', to: 'Detroit, USA', departureDate: '2027-08-15' };
        const parsed = multiCityLegSchema.safeParse(leg);
        expect(parsed.success).toBe(true);
    });
});
