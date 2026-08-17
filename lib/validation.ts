import { z, ZodError, ZodType } from 'zod';
import { validateSeatingLayout } from '@/lib/seatLayout';
import { ActionValidationFailure } from '@/lib/actionResult';
import { isValidAuthToken } from '@/lib/authTokenFormat';
import { airportTimeZoneFor } from '@/lib/airports';
import { normalizeAccountTimeZone } from '@/lib/accountTimeZone';
import {
    DEPARTURE_AFTER_BOOKING_WINDOW_MESSAGE,
    RETURN_AFTER_BOOKING_WINDOW_MESSAGE,
    bookingWindowIsoDates,
} from '@/lib/dates';

export const MAX_MUTATION_BYTES = 1_000_000;
export const MAX_REGISTRATION_BYTES = 16_384;
export const MAX_PASSENGERS_PER_BOOKING = 9;
/// Outbound and inbound. Multi-city itineraries raise this once P1.3 lands.
export const MAX_ITINERARY_LEGS = 2;

const requiredText = (label: string, max: number) => z.string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is too long.`);

const positiveId = (label: string) => z.number({ error: `${label} must be a number.` })
    .int(`${label} must be an integer.`)
    .positive(`${label} must be positive.`);

const dateOnlySchema = z.union([z.string(), z.date()]).transform((value, context) => {
    if (value instanceof Date && Number.isNaN(value.getTime())) {
        context.addIssue({ code: 'custom', message: 'Date is invalid.' });
        return z.NEVER;
    }
    const rawValue = value instanceof Date ? value.toISOString() : value.trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawValue);
    const isIsoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(rawValue);
    if (!isDateOnly && !isIsoDateTime) {
        context.addIssue({ code: 'custom', message: 'Date must use YYYY-MM-DD or ISO datetime format.' });
        return z.NEVER;
    }
    if (isIsoDateTime && Number.isNaN(new Date(rawValue).getTime())) {
        context.addIssue({ code: 'custom', message: 'Date is invalid.' });
        return z.NEVER;
    }
    const stringValue = isIsoDateTime ? rawValue.slice(0, 10) : rawValue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
        context.addIssue({ code: 'custom', message: 'Date must use YYYY-MM-DD format.' });
        return z.NEVER;
    }
    const date = new Date(`${stringValue}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== stringValue) {
        context.addIssue({ code: 'custom', message: 'Date is invalid.' });
        return z.NEVER;
    }
    const today = new Date();
    const todayString = today.toISOString().slice(0, 10);
    if (stringValue > todayString || stringValue < '1900-01-01') {
        context.addIssue({
            code: 'custom',
            message: 'Date must be between 1900-01-01 and today.'
        });
        return z.NEVER;
    }
    return stringValue;
});

const isoDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must use YYYY-MM-DD format.')
    .refine(value => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, 'Date is invalid.');

export const emailAddressSchema = z.string()
    .trim()
    .toLowerCase()
    .max(254, 'Email address is too long.')
    .email('Enter a valid email address.');

export const passwordSchema = z.string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password is too long.');

export const accountTimeZoneSchema = z.string()
    .trim()
    .min(1, 'Timezone is required.')
    .max(100, 'Timezone is too long.')
    .transform((value, context) => {
        const normalized = normalizeAccountTimeZone(value);
        if (normalized) return normalized;
        context.addIssue({ code: 'custom', message: 'Choose a recognized IANA timezone.' });
        return z.NEVER;
    });

const oneTimeTokenSchema = z.string().refine(
    isValidAuthToken,
    'This link is invalid or expired.'
);

export const registrationSchema = z.object({
    name: requiredText('Name', 100),
    email: emailAddressSchema,
    password: passwordSchema
}).strict();

export const authEmailRequestSchema = z.object({ email: emailAddressSchema }).strict();
export const authTokenSchema = z.object({ token: oneTimeTokenSchema }).strict();
export const passwordResetSchema = z.object({
    token: oneTimeTokenSchema,
    password: passwordSchema,
}).strict();

export const favoriteSchema = z.object({
    cityGuideId: positiveId('City guide ID')
}).strict();

export const reviewSchema = z.object({
    cityGuideId: positiveId('City guide ID'),
    rating: z.number().int().min(1).max(5),
    content: requiredText('Review', 2_000)
}).strict();

export const cabinClassSchema = z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);

export const searchFlightsSchema = z.object({
    from: requiredText('Origin', 120),
    to: requiredText('Destination', 120),
    departureDate: isoDateSchema.optional(),
    returnDate: isoDateSchema.optional(),
    /// The cabin being shopped. Results are priced and filtered for it, so an
    /// unknown value is rejected rather than quietly treated as economy.
    cabinClass: cabinClassSchema.default('ECONOMY'),
}).strict().superRefine(({ from, departureDate, returnDate }, context) => {
    // The window is the origin airport's calendar day, not UTC's. A place with
    // no airport record falls back to UTC rather than rejecting the search.
    const {
        earliestDate: earliestBookableDate,
        latestDate: latestBookableDate,
    } = bookingWindowIsoDates(new Date(), airportTimeZoneFor(from));

    if (departureDate && departureDate < earliestBookableDate) {
        context.addIssue({
            code: 'custom',
            path: ['departureDate'],
            message: 'Departure date cannot be in the past.',
        });
    }
    if (departureDate && departureDate > latestBookableDate) {
        context.addIssue({
            code: 'custom',
            path: ['departureDate'],
            message: DEPARTURE_AFTER_BOOKING_WINDOW_MESSAGE,
        });
    }

    if (returnDate && !departureDate) {
        context.addIssue({
            code: 'custom',
            path: ['departureDate'],
            message: 'Departure date is required when a return date is provided.',
        });
    } else if (departureDate && returnDate && returnDate < departureDate) {
        context.addIssue({
            code: 'custom',
            path: ['returnDate'],
            message: 'Return date cannot be before departure date.',
        });
    }
    if (returnDate && returnDate > latestBookableDate) {
        context.addIssue({
            code: 'custom',
            path: ['returnDate'],
            message: RETURN_AFTER_BOOKING_WINDOW_MESSAGE,
        });
    }
});

const coverImageSchema = z.string()
    .trim()
    .max(750_000, 'Cover image is too large.')
    .refine(
        value => value.startsWith('data:image/') || value.startsWith('/') || /^https?:\/\//.test(value),
        'Cover image must be an image URL or data URL.'
    );

export const cityGuideSchema = z.object({
    id: positiveId('City guide ID').optional(),
    city: requiredText('City', 100),
    country: requiredText('Country', 100),
    latlong: z.tuple([
        z.number().finite().min(-90).max(90),
        z.number().finite().min(-180).max(180)
    ]),
    description: requiredText('Description', 5_000),
    highlights: z.array(requiredText('Highlight', 200)).min(1).max(20),
    coverImage: coverImageSchema.nullish()
}).strict();

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:MM format.');
const rowCountSchema = z.number()
    .int('Row configurations must be non-negative integers.')
    .nonnegative('Row configurations must be non-negative integers.');

export const scheduleSchema = z.object({
    id: positiveId('Schedule ID').optional(),
    flightNumber: requiredText('Flight number', 10)
        .transform(value => value.toUpperCase().replace(/\s+/g, ''))
        .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, 'Flight number contains invalid characters.')),
    airline: requiredText('Airline', 120),
    from: requiredText('Origin', 120),
    to: requiredText('Destination', 120),
    departureTime: timeSchema,
    /// Elapsed minutes gate to gate. A schedule that cannot say how long its
    /// flight takes cannot produce an arrival time, and the alternative --
    /// subtracting local times across a timezone -- is not a duration (#84).
    /// Capped at three days, which is longer than any commercial sector and
    /// short enough to catch a number typed in the wrong unit.
    durationMinutes: z.coerce.number({ message: 'Flight duration is required.' })
        .int('Flight duration must be a whole number of minutes.')
        .min(1, 'Flight duration must be at least one minute.')
        .max(3 * 24 * 60, 'Flight duration must be shorter than three days.'),
    daysOfWeek: z.array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .refine(days => new Set(days).size === days.length, 'Days of week must be unique.')
        .transform(days => [...days].sort((left, right) => left - right)),
    /// Thousands separators are accepted because the edit form seeds this field
    /// from formatPrice, which emits them. Rejecting its own output would make a
    /// schedule impossible to re-save unedited.
    price: requiredText('Price', 32)
        .regex(/^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/, 'Price format is invalid.'),
    firstClassRows: rowCountSchema.default(3),
    businessRows: rowCountSchema.default(3),
    premiumEconomyRows: rowCountSchema.default(4),
    economyRows: rowCountSchema.default(20),
    seatPattern: z.string().default('ABC-DEF')
}).strict().transform((schedule, context) => {
    try {
        return {
            ...schedule,
            seatPattern: validateSeatingLayout(
                schedule.firstClassRows,
                schedule.businessRows,
                schedule.premiumEconomyRows,
                schedule.economyRows,
                schedule.seatPattern
            )
        };
    } catch (error) {
        context.addIssue({
            code: 'custom',
            path: ['seatPattern'],
            message: error instanceof Error ? error.message : 'Seating layout is invalid.'
        });
        return z.NEVER;
    }
});

export const flightScheduleTermsSchema = z.object({
    requestId: z.uuid('Schedule update request ID must be a UUID.'),
    flightScheduleId: positiveId('Schedule ID'),
    durationMinutes: z.coerce.number({ message: 'Flight duration is required.' })
        .int('Flight duration must be a whole number of minutes.')
        .min(1, 'Flight duration must be at least one minute.')
        .max(3 * 24 * 60, 'Flight duration must be shorter than three days.'),
    price: requiredText('Price', 32)
        .regex(/^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/, 'Price format is invalid.'),
    confirmed: z.boolean().refine(
        confirmed => confirmed,
        'Review the schedule impact before updating.',
    ),
}).strict();

export const flightScheduleActivationSchema = z.object({
    flightScheduleId: positiveId('Schedule ID'),
    isActive: z.boolean(),
}).strict();

export const flightScheduleDeletionSchema = z.object({
    requestId: z.uuid('Schedule deletion request ID must be a UUID.'),
    flightScheduleId: positiveId('Schedule ID'),
    confirmed: z.boolean().refine(confirmed => confirmed, 'Confirm permanent deletion.'),
}).strict();

const seatNumberSchema = requiredText('Seat number', 6)
    .transform(value => value.toUpperCase())
    .pipe(z.string().regex(/^[1-9]\d{0,2}[A-Z]$/, 'Seat number is invalid.'));

export const passengerSchema = z.object({
    firstName: requiredText('First name', 100),
    lastName: requiredText('Last name', 100),
    dateOfBirth: dateOnlySchema,
    passportNumber: requiredText('Passport number', 32)
        .transform(value => value.toUpperCase())
        .pipe(z.string().regex(/^[A-Z0-9-]+$/, 'Passport number contains invalid characters.')),
    gender: z.enum(['Male', 'Female', 'Other']),
    /// One seat per leg, in the same order as the itinerary's flights.
    seatNumbers: z.array(seatNumberSchema, { error: 'A seat is required for each flight.' })
        .min(1, 'A seat is required for each flight.')
        .max(MAX_ITINERARY_LEGS),
    cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'])
}).strict();

export const bookingRequestIdSchema = z.uuid('Booking request ID must be a UUID.');

const checkoutPaymentPassengerSchema = z.object({
    seatNumbers: z.array(seatNumberSchema, { error: 'A seat is required for each flight.' })
        .min(1, 'A seat is required for each flight.')
        .max(MAX_ITINERARY_LEGS),
    cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']),
}).strict();

export const checkoutPaymentRequestSchema = z.object({
    checkoutId: bookingRequestIdSchema,
    flightIds: z.array(positiveId('Flight ID'), { error: 'A flight is required.' })
        .min(1, 'A flight is required.')
        .max(MAX_ITINERARY_LEGS),
    passengers: z.array(checkoutPaymentPassengerSchema, {
        error: 'At least one passenger is required.',
    }).min(1, 'At least one passenger is required.').max(MAX_PASSENGERS_PER_BOOKING),
}).strict().superRefine(({ flightIds, passengers }, context) => {
    if (new Set(flightIds).size !== flightIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['flightIds'],
            message: 'An itinerary cannot repeat a flight.',
        });
    }

    passengers.forEach((passenger, passengerIndex) => {
        if (passenger.seatNumbers.length !== flightIds.length) {
            context.addIssue({
                code: 'custom',
                path: ['passengers', passengerIndex, 'seatNumbers'],
                message: 'A seat is required for each flight.',
            });
        }
    });

    flightIds.forEach((_, legIndex) => {
        const claimedSeats = passengers.map(passenger => passenger.seatNumbers[legIndex]);
        if (new Set(claimedSeats).size !== claimedSeats.length) {
            context.addIssue({
                code: 'custom',
                path: ['passengers'],
                message: 'Travellers cannot select the same seat on one flight.',
            });
        }
    });

});

export const checkoutPaymentServiceSchema = checkoutPaymentRequestSchema.extend({
    userId: requiredText('User ID', 128),
});

export const bookingRequestSchema = z.object({
    /// The itinerary, in leg order. One flight for a one-way trip, two for a
    /// round trip.
    flightIds: z.array(positiveId('Flight ID'), { error: 'A flight is required.' })
        .min(1, 'A flight is required.')
        .max(MAX_ITINERARY_LEGS),
    passengers: z.array(passengerSchema, { error: 'At least one passenger is required.' })
        .min(1, 'At least one passenger is required.')
        .max(MAX_PASSENGERS_PER_BOOKING),
    idempotencyKey: bookingRequestIdSchema
}).strict().superRefine(({ flightIds, passengers }, context) => {
    if (new Set(flightIds).size !== flightIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['flightIds'],
            message: 'An itinerary cannot repeat a flight.',
        });
    }

    // Every traveller needs a seat on every leg, or the itinerary is incomplete
    // in a way the database would only catch as a missing assignment.
    passengers.forEach((passenger, index) => {
        if (passenger.seatNumbers.length !== flightIds.length) {
            context.addIssue({
                code: 'custom',
                path: ['passengers', index, 'seatNumbers'],
                message: 'A seat is required for each flight.',
            });
        }
    });
});

export const flightBookingServiceSchema = bookingRequestSchema.extend({
    userId: requiredText('User ID', 128),
    // This is a server-owned value. The default preserves older internal
    // callers and legacy bookings; the checkout action always supplies it.
    paymentIntentId: requiredText('Payment intent ID', 255).nullable().default(null),
});

const seatChangeSchema = z.object({
    passengerId: requiredText('Passenger ID', 128),
    /// The leg the seat is held on. A seat belongs to one flight, so a change
    /// has to name which one; without it a round trip has no way to say which
    /// of its seats is moving.
    legId: positiveId('Leg ID'),
    seatNumber: requiredText('Seat number', 6)
        .transform(value => value.toUpperCase())
        .pipe(z.string().regex(/^[1-9]\d{0,2}[A-Z]$/, 'Seat number is invalid.'))
}).strict();

export const seatChangesSchema = z.object({
    bookingId: positiveId('Booking ID'),
    seatChanges: z.array(seatChangeSchema)
        .min(1)
        .max(MAX_PASSENGERS_PER_BOOKING * MAX_ITINERARY_LEGS)
}).strict().superRefine(({ seatChanges }, context) => {
    // Both rules are per leg. A traveller holds one seat on each leg, so the
    // same passenger appears once per leg; and two legs are two flights, so the
    // same seat number on each of them is not a clash.
    const seatsPerLeg = seatChanges.map(change => `${change.legId}:${change.seatNumber}`);
    const passengersPerLeg = seatChanges.map(change => `${change.legId}:${change.passengerId}`);
    if (new Set(passengersPerLeg).size !== passengersPerLeg.length) {
        context.addIssue({ code: 'custom', path: ['seatChanges'], message: 'Passengers must be unique.' });
    }
    if (new Set(seatsPerLeg).size !== seatsPerLeg.length) {
        context.addIssue({ code: 'custom', path: ['seatChanges'], message: 'Seats must be unique.' });
    }
});

const rebookingSeatSchema = z.object({
    passengerId: requiredText('Passenger ID', 128),
    seatNumber: seatNumberSchema,
}).strict();

const rebookingLegSchema = z.object({
    fromLegId: positiveId('Leg ID'),
    replacementFlightId: positiveId('Replacement flight ID'),
    seats: z.array(rebookingSeatSchema)
        .min(1, 'Select one replacement seat for every passenger.')
        .max(MAX_PASSENGERS_PER_BOOKING),
}).strict().superRefine(({ seats }, context) => {
    const passengerIds = seats.map(seat => seat.passengerId);
    const seatNumbers = seats.map(seat => seat.seatNumber);
    if (new Set(passengerIds).size !== passengerIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['seats'],
            message: 'Passengers must be unique on each replacement flight.',
        });
    }
    if (new Set(seatNumbers).size !== seatNumbers.length) {
        context.addIssue({
            code: 'custom',
            path: ['seats'],
            message: 'Seats must be unique on each replacement flight.',
        });
    }
});

export const rebookItineraryRequestSchema = z.object({
    bookingId: positiveId('Booking ID'),
    replacements: z.array(rebookingLegSchema)
        .min(1, 'Choose at least one replacement flight.')
        .max(MAX_ITINERARY_LEGS),
}).strict().superRefine(({ replacements }, context) => {
    const legIds = replacements.map(replacement => replacement.fromLegId);
    const flightIds = replacements.map(replacement => replacement.replacementFlightId);
    if (new Set(legIds).size !== legIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['replacements'],
            message: 'Cancelled legs must be unique.',
        });
    }
    if (new Set(flightIds).size !== flightIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['replacements'],
            message: 'Replacement flights must be unique.',
        });
    }
});

export type RebookItineraryRequest = z.infer<typeof rebookItineraryRequestSchema>;

export const numericIdSchema = positiveId('ID');
export const stringIdSchema = requiredText('ID', 128);
export const flightStatusSchema = z.enum(['ON_TIME', 'DELAYED', 'CANCELLED']);

export const occurrenceRequestSchema = z.object({
    scheduleId: positiveId('Schedule ID'),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    seatingConfig: z.object({
        firstClassRows: rowCountSchema.nullish(),
        businessRows: rowCountSchema.nullish(),
        premiumEconomyRows: rowCountSchema.nullish(),
        economyRows: rowCountSchema.nullish(),
        seatPattern: z.string().max(64).nullish()
    }).strict().optional()
}).strict().refine(input => input.endDate >= input.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after start date.'
}).refine(input => {
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    const end = new Date(`${input.endDate}T00:00:00.000Z`);
    return (end.getTime() - start.getTime()) / 86_400_000 <= 366;
}, {
    path: ['endDate'],
    message: 'Date range cannot exceed 366 days.'
});

export class InputValidationError extends Error {
    readonly code = 'VALIDATION_ERROR';
    readonly fields: Record<string, string[]>;

    constructor(fields: Record<string, string[]>, message = 'Please correct the highlighted fields.') {
        super(message);
        this.name = 'InputValidationError';
        this.fields = fields;
    }
}

function serializedBytes(input: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8');
    } catch {
        throw new InputValidationError({ _root: ['Request could not be read.'] });
    }
}

export function parseInput<T>(schema: ZodType<T>, input: unknown, maxBytes = MAX_MUTATION_BYTES): T {
    if (serializedBytes(input) > maxBytes) {
        throw new InputValidationError({ _root: ['Request is too large.'] }, 'Request is too large.');
    }
    try {
        return schema.parse(input);
    } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        const fields: Record<string, string[]> = {};
        for (const issue of error.issues) {
            const field = issue.path.join('.') || '_root';
            fields[field] = [...(fields[field] ?? []), issue.message];
        }
        throw new InputValidationError(fields, error.issues[0]?.message);
    }
}

export function validationErrorPayload(error: InputValidationError) {
    return {
        error: {
            code: error.code,
            message: error.message,
            fields: error.fields
        }
    };
}

export function parseActionInput<T>(
    schema: ZodType<T>,
    input: unknown,
    maxBytes = MAX_MUTATION_BYTES
): { ok: true; data: T } | ActionValidationFailure {
    try {
        return { ok: true, data: parseInput(schema, input, maxBytes) };
    } catch (error) {
        if (!(error instanceof InputValidationError)) throw error;
        return {
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: error.message,
                fields: error.fields
            }
        };
    }
}

export async function parseJsonRequest<T>(
    request: Request,
    schema: ZodType<T>,
    maxBytes = MAX_REGISTRATION_BYTES
): Promise<T> {
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new InputValidationError({ _root: ['Request is too large.'] }, 'Request is too large.');
    }

    const body = await request.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        throw new InputValidationError({ _root: ['Request is too large.'] }, 'Request is too large.');
    }
    let input: unknown;
    try {
        input = JSON.parse(body);
    } catch {
        throw new InputValidationError({ _root: ['Request body must be valid JSON.'] });
    }
    return parseInput(schema, input, maxBytes);
}

/**
 * The seats a customer is asking to hold while they pay (#74).
 *
 * Bounded because the list arrives from the browser and each entry costs a
 * write: nine passengers is the most any itinerary here carries, across at most
 * two legs, so eighteen is the ceiling with nothing legitimate above it.
 */
export const seatClaimsSchema = z
    .array(
        z.object({
            flightId: numericIdSchema,
            seatNumber: z.string().trim().min(2).max(4).regex(/^[0-9]{1,3}[A-Z]$/),
        }),
    )
    .min(1)
    .max(18);

export const checkoutSeatClaimsSchema = z.object({
    checkoutId: bookingRequestIdSchema,
    claims: seatClaimsSchema,
}).strict();
