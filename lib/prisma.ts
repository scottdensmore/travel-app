import { Prisma, PrismaClient } from '@prisma/client';

export function sanitizePrismaErrorMessage(error: unknown): void {
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
        const err = error as { message: string };
        const safePrefix = beforeRowData(err.message);
        if (safePrefix.length < err.message.length) {
            err.message = `${safePrefix.trimEnd()} [ROW DATA REDACTED]`;
        }
    }
}

function extendClient(client: PrismaClient): PrismaClient {
    if (typeof client.$extends === 'function') {
        return client.$extends({
            query: {
                $allModels: {
                    async $allOperations({ query, args }) {
                        try {
                            return await query(args);
                        } catch (error) {
                            sanitizePrismaErrorMessage(error);
                            throw error;
                        }
                    },
                },
            },
        }) as unknown as PrismaClient;
    }
    return client;
}

function createPrismaClient(): PrismaClient {
    if (isDevelopment) {
        const developmentLog: Prisma.LogLevel[] = ['query', 'warn', 'error'];
        const client = new PrismaClient({ log: developmentLog });
        return extendClient(client);
    }

    const client = new PrismaClient({
        log: [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
        ],
    });

    if (typeof client.$on === 'function') {
        client.$on('warn', (event) => {
            console.warn(redactPrismaLogEvent('warn', event));
        });
        client.$on('error', (event) => {
            console.error(redactPrismaLogEvent('error', event));
        });
    }

    return extendClient(client);
}

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

const isDevelopment = process.env.NODE_ENV === 'development';

export type PrismaLogLevel = 'warn' | 'error';

export interface PrismaLogEvent {
    timestamp: Date;
    message: string;
    target: string;
}

export interface RedactedPrismaLogRecord {
    level: PrismaLogLevel;
    timestamp: Date;
    target: string;
    /** Postgres SQLSTATE, or a Prisma `P####` code. */
    code: string | null;
    relation: string | null;
    constraint: string | null;
    /** Column names, for the unique-constraint form that names no relation. */
    fields: string[] | null;
}

/**
 * Everything after one of these is row data, so no pattern below is allowed to
 * see it.
 *
 * A NOT NULL or foreign-key violation formats the *whole* message as the
 * failing row, and a row can contain the literal text `relation "..."` — so a
 * pattern run over the full message will happily extract a column value and
 * call it a schema name.
 *
 * This list is a mitigation, not a boundary: it names the places Postgres is
 * known to put row data. A class 22 error quotes the offending value in its
 * primary message, where none of these markers precede it — that case is #163,
 * and it is a forgery risk rather than a disclosure one.
 */
const ROW_DATA_MARKERS = [
    /Failing row contains/i,
    /\bDETAIL:/,
    /detail: Some\(/,
    /\bKey \(/,
];

function beforeRowData(message: string): string {
    let end = message.length;
    for (const marker of ROW_DATA_MARKERS) {
        const index = message.search(marker);
        if (index !== -1 && index < end) end = index;
    }
    return message.slice(0, end);
}

const STATIC_MODELS: readonly string[] = [
    'Account',
    'Session',
    'User',
    'VerificationToken',
    'AuthRateLimit',
    'CityGuide',
    'PaymentAttempt',
    'PaymentWebhookEvent',
    'Booking',
    'BookingStatusChange',
    'BookingRebooking',
    'BookingRebookingLeg',
    'PaymentRefund',
    'PaymentRefundAttempt',
    'Passenger',
    'Flight',
    'UserFavorite',
    'Review',
    'FlightSchedule',
    'FlightScheduleTermsChange',
    'FlightScheduleDeletion',
    'Notification',
    'Airport',
    'ItineraryLeg',
    'SeatHold',
    'SeatAssignment',
];

function getKnownModels(): Set<string> {
    const models = new Set<string>(STATIC_MODELS);
    try {
        if (typeof Prisma !== 'undefined' && Prisma?.dmmf?.datamodel?.models) {
            for (const model of Prisma.dmmf.datamodel.models) {
                models.add(model.name);
                if (model.dbName) models.add(model.dbName);
            }
        }
    } catch {
        // Fall back to STATIC_MODELS if Prisma is mocked without dmmf
    }
    return models;
}

const KNOWN_MIGRATION_CONSTRAINTS: readonly string[] = [
    'Account_pkey',
    'Account_userId_fkey',
    'Airport_pkey',
    'AuthRateLimit_pkey',
    'BookingRebookingLeg_different_legs',
    'BookingRebookingLeg_fromLegId_fkey',
    'BookingRebookingLeg_pkey',
    'BookingRebookingLeg_rebookingId_fkey',
    'BookingRebookingLeg_toLegId_fkey',
    'BookingRebooking_bookingId_fkey',
    'BookingRebooking_bookingStatusChangeId_fkey',
    'BookingRebooking_pkey',
    'BookingStatusChange_actorUserId_fkey',
    'BookingStatusChange_bookingId_fkey',
    'BookingStatusChange_pkey',
    'Booking_flightId_fkey',
    'Booking_nonempty_payment_intent',
    'Booking_pkey',
    'Booking_reference_format',
    'Booking_totalPriceCents_non_negative_check',
    'Booking_userId_fkey',
    'CityGuide_pkey',
    'FlightScheduleDeletion_actorUserId_fkey',
    'FlightScheduleDeletion_counts_valid',
    'FlightScheduleDeletion_duration_positive',
    'FlightScheduleDeletion_pkey',
    'FlightScheduleDeletion_price_nonnegative',
    'FlightScheduleDeletion_request_nonempty',
    'FlightScheduleDeletion_schedule_positive',
    'FlightScheduleTermsChange_actorUserId_fkey',
    'FlightScheduleTermsChange_counts_nonnegative',
    'FlightScheduleTermsChange_duration_positive',
    'FlightScheduleTermsChange_flightScheduleId_fkey',
    'FlightScheduleTermsChange_pkey',
    'FlightScheduleTermsChange_price_nonnegative',
    'FlightScheduleTermsChange_request_nonempty',
    'FlightSchedule_durationMinutes_positive',
    'FlightSchedule_pkey',
    'FlightSchedule_priceCents_check',
    'Flight_durationMinutes_positive',
    'Flight_flightScheduleId_fkey',
    'Flight_fromAirportCode_fkey',
    'Flight_pkey',
    'Flight_priceCents_check',
    'Flight_toAirportCode_fkey',
    'ItineraryLeg_bookingId_fkey',
    'ItineraryLeg_flightId_fkey',
    'ItineraryLeg_pkey',
    'ItineraryLeg_sequence_positive_check',
    'Notification_pkey',
    'Notification_userId_fkey',
    'Passenger_bookingId_fkey',
    'Passenger_flightId_fkey',
    'Passenger_pkey',
    'Passenger_sensitive_data_state_check',
    'PaymentAttempt_captured_has_time',
    'PaymentAttempt_iso_currency',
    'PaymentAttempt_pkey',
    'PaymentAttempt_positive_amount',
    'PaymentAttempt_sha256_fingerprint',
    'PaymentAttempt_userId_fkey',
    'PaymentRefundAttempt_nonempty_id',
    'PaymentRefundAttempt_nonempty_provider_refund',
    'PaymentRefundAttempt_paymentRefundId_fkey',
    'PaymentRefundAttempt_pkey',
    'PaymentRefund_bookingStatusChangeId_fkey',
    'PaymentRefund_currency_format',
    'PaymentRefund_nonempty_provider_intent',
    'PaymentRefund_pkey',
    'PaymentRefund_positive_amount',
    'PaymentWebhookEvent_nonempty_event_type',
    'PaymentWebhookEvent_nonempty_provider_intent',
    'PaymentWebhookEvent_paymentAttemptId_fkey',
    'PaymentWebhookEvent_pkey',
    'Review_cityGuideId_fkey',
    'Review_pkey',
    'Review_userId_fkey',
    'SeatAssignment_flightId_fkey',
    'SeatAssignment_legId_flightId_fkey',
    'SeatAssignment_passengerId_fkey',
    'SeatAssignment_pkey',
    'SeatHold_expires_after_it_is_made',
    'SeatHold_flightId_fkey',
    'SeatHold_pkey',
    'Session_pkey',
    'Session_userId_fkey',
    'UserFavorite_cityGuideId_fkey',
    'UserFavorite_pkey',
    'UserFavorite_userId_fkey',
    'User_email_canonical_check',
    'User_pkey',
    'User_staff_mfa_state_check',
    'User_timeZone_well_formed',
];

const KNOWN_CONSTRAINTS = new Set<string>(KNOWN_MIGRATION_CONSTRAINTS);

function isValidConstraint(constraint: string, knownModels: Set<string>): boolean {
    if (KNOWN_CONSTRAINTS.has(constraint)) {
        return true;
    }
    const match = /^([A-Za-z0-9]+)_(?:.*_)?(pkey|fkey|key|check)$/.exec(constraint);
    if (match) {
        const [, modelName] = match;
        if (knownModels.has(modelName)) {
            return true;
        }
    }
    return false;
}

/**
 * Postgres quotes schema names, Prisma re-escapes them on the way through, and
 * the raw-query path spells the code differently again — hence the alternatives.
 */
const CODE = /\bcode:\s*["`]([0-9A-Za-z]{5})["`]/i;
const PRISMA_CODE = /\b(P\d{4})\b/;

/**
 * A quoted schema name, wherever Postgres puts one.
 *
 * These are deliberately not anchored to Postgres's sentence templates. That
 * was tried: it cost the `42P01` / `42P07` / `42704` schema-drift diagnostics —
 * the ones worth most when a deploy meets an unmigrated database — and bought
 * nothing, because a caller who can plant `relation "x"` in their own input can
 * equally plant `new row for relation "x" violates`. Lengthening the phrase
 * only lengthens the payload.
 *
 * What that leaves is a forgery risk rather than a disclosure one: someone able
 * to get a chosen string into a failing query can write chosen text into these
 * two fields. It cannot reach another customer's data, which is #142's concern,
 * and closing it properly means checking the extracted name against the schema
 * rather than against its shape (#163).
 */
const RELATION = /relation \\?"([A-Za-z0-9_]+)\\?"/;
const CONSTRAINT = /constraint \\?"([A-Za-z0-9_]+)\\?"/;
/** `Unique constraint failed on the fields: (`email`)` — no SQLSTATE at all. */
const UNIQUE_FIELDS = /Unique constraint failed on the fields?: \(([^)]*)\)/;
/**
 * Prisma 5 says `Foreign key constraint violated: `X (index)``; older wording
 * was `failed on the field:`. Neither string exists in the JS runtime — they
 * come from the Rust engine, so both are kept.
 */
const FOREIGN_KEY = /Foreign key constraint (?:violated|failed on the field):\s*`?([A-Za-z0-9_]+)/;

function firstMatch(pattern: RegExp, message: string): string | null {
    return pattern.exec(message)?.[1] ?? null;
}

/**
 * Keeps only what is shaped like a bare identifier.
 *
 * This is a filter on shape, not on provenance: it drops anything carrying `@`,
 * `.`, `-`, `/` or whitespace, which is what makes an email address — the #142
 * payload — unable to pass. An identifier-shaped secret such as a cuid or a hex
 * digest fits the shape, so this is not a boundary either; `beforeRowData` is
 * what keeps values out, and #163 covers the rest.
 */
function identifiers(captured: string | null): string[] | null {
    if (captured === null) return null;
    const names = captured
        .split(',')
        .map((name) => name.trim().replace(/[`"]/g, ''))
        .filter((name) => /^[A-Za-z0-9_]+$/.test(name));
    return names.length > 0 ? names : null;
}

/**
 * Builds the record that is safe to write for a Prisma warning or error.
 *
 * A Postgres error embeds the offending row in its `detail` — the observed case
 * was a customer's email address on stdout in production (#142) — so the record
 * is assembled from named fields rather than filtered down from the message.
 * Anything not on this list is dropped, including the message itself: an
 * unrecognised failure may carry anything, and a whitelist is the only form of
 * this that stays correct as Prisma's wording changes.
 *
 * The cost is real. An operator gets the code, the relation, the constraint and
 * the columns, which is enough to identify a failure but not to read the values
 * behind it. Reproducing with data is a development-environment job, where
 * `query` logging is still on and the data is seeded.
 *
 * Warnings go through the same treatment, which looks over-cautious given they
 * are engine and client messages rather than query results. They are not
 * exempt: Prisma interpolates an arbitrary upstream message into its retry
 * warning, and it puts connection identity into log text elsewhere — a failed
 * connection names the database user. There is no level that is safe by
 * default, so none is treated as one.
 */
export function redactPrismaLogEvent(
    level: PrismaLogLevel,
    event: PrismaLogEvent,
): RedactedPrismaLogRecord {
    const safe = beforeRowData(event.message);
    const fields = identifiers(firstMatch(UNIQUE_FIELDS, safe));

    const code =
        firstMatch(CODE, safe)
        ?? firstMatch(PRISMA_CODE, safe)
        ?? (fields ? 'P2002' : null)
        ?? (FOREIGN_KEY.test(safe) ? 'P2003' : null);

    let relation = firstMatch(RELATION, safe);
    let constraint = firstMatch(CONSTRAINT, safe) ?? firstMatch(FOREIGN_KEY, safe);

    if (code?.startsWith('22')) {
        relation = null;
        constraint = null;
    } else {
        const knownModels = getKnownModels();
        const isSchemaDriftRelation = code === '42P01' || code === '42P07' || code === '42704';
        const isSchemaDriftConstraint = code === '42704';

        if (relation && !isSchemaDriftRelation && !knownModels.has(relation)) {
            relation = null;
        }

        if (constraint && !isSchemaDriftConstraint && !isValidConstraint(constraint, knownModels)) {
            constraint = null;
        }
    }

    return {
        level,
        timestamp: event.timestamp,
        target: event.target,
        code,
        relation,
        constraint,
        fields,
    };
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

