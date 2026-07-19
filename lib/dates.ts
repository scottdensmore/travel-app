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

export function bookingWindowIsoDates(referenceDate = new Date()): {
    earliestDate: string;
    latestDate: string;
} {
    const today = todayIsoDate(referenceDate);
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

export function earliestBookableDateIso(): string {
    return bookingWindowIsoDates().earliestDate;
}

export function latestBookableDateIso(): string {
    return bookingWindowIsoDates().latestDate;
}
