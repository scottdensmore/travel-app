import { airportLocalDate } from './airports';

export const MIN_BOOKING_LEAD_DAYS = 0;
export const MAX_BOOKING_LEAD_DAYS = 365;

export const DEPARTURE_AFTER_BOOKING_WINDOW_MESSAGE =
    `Departure date cannot be more than ${MAX_BOOKING_LEAD_DAYS} days in advance.`;
export const RETURN_AFTER_BOOKING_WINDOW_MESSAGE =
    `Return date cannot be more than ${MAX_BOOKING_LEAD_DAYS} days in advance.`;

export function addDaysToIsoDate(dateString: string, days: number): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/**
 * The dates a customer may select, as calendar days at the origin airport.
 *
 * `originTimeZone` is the IANA zone of the place being departed from. Pass it
 * wherever an origin is known: "today" in Tokyo is already tomorrow for much of
 * the UTC evening, so a UTC-anchored window offers the wrong earliest date.
 * Omitting it falls back to the UTC day, which is what happens for a place with
 * no airport record.
 *
 * The same function runs in the browser and on the server, deliberately, so the
 * date picker cannot offer a date the server would reject.
 */
export function bookingWindowIsoDates(referenceDate = new Date(), originTimeZone?: string | null): {
    earliestDate: string;
    latestDate: string;
} {
    const today = originTimeZone
        ? airportLocalDate(originTimeZone, referenceDate)
        : todayIsoDate(referenceDate);
    return {
        earliestDate: addDaysToIsoDate(today, MIN_BOOKING_LEAD_DAYS),
        latestDate: addDaysToIsoDate(today, MAX_BOOKING_LEAD_DAYS),
    };
}

/**
 * The current date as an ISO `YYYY-MM-DD` string.
 *
 * Anchored to UTC, matching how flight dates are modeled throughout the app
 * (see `FlightScheduleService`, which stores departure times as UTC wall-clock
 * values). This is the single source of truth for "today" used by the search
 * date constraints, including the booking-window helpers, so the client and
 * server stay consistent. Displaying flight times in an airport's local
 * timezone is tracked separately and would require per-airport timezone data
 * that the schema does not yet carry.
 */
export function todayIsoDate(referenceDate = new Date()): string {
    return referenceDate.toISOString().slice(0, 10);
}

export function earliestBookableDateIso(originTimeZone?: string | null): string {
    return bookingWindowIsoDates(new Date(), originTimeZone).earliestDate;
}

export function latestBookableDateIso(originTimeZone?: string | null): string {
    return bookingWindowIsoDates(new Date(), originTimeZone).latestDate;
}

/**
 * The offset of a zone from UTC at a given instant, in milliseconds.
 * Derived from the formatter rather than a table, so it follows daylight saving.
 */
function zoneOffsetMilliseconds(timeZone: string, instant: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(instant);
    const valueOf = (type: string) => Number(parts.find(part => part.type === type)?.value);

    const asIfUtc = Date.UTC(
        valueOf('year'),
        valueOf('month') - 1,
        valueOf('day'),
        // Some engines report midnight as hour 24.
        valueOf('hour') % 24,
        valueOf('minute'),
        valueOf('second'),
    );

    return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

/**
 * Milliseconds until the calendar day rolls over at the origin airport.
 *
 * A page left open across the origin's midnight has to refresh the dates it
 * offers. Tokyo rolls over at 15:00 UTC and Los Angeles at 07:00 or 08:00, so a
 * UTC-midnight timer would leave the picker stale for most of a day.
 *
 * Without a zone this is the UTC day boundary.
 */
export function millisecondsUntilNextLocalDay(
    originTimeZone?: string | null,
    referenceDate = new Date(),
): number {
    const offset = originTimeZone ? zoneOffsetMilliseconds(originTimeZone, referenceDate) : 0;
    const local = new Date(referenceDate.getTime() + offset);
    const nextLocalMidnight = Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + 1,
    );

    return nextLocalMidnight - offset - referenceDate.getTime();
}
