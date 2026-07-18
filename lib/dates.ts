/**
 * The current date as an ISO `YYYY-MM-DD` string.
 *
 * Anchored to UTC, matching how flight dates are modeled throughout the app
 * (see `FlightScheduleService`, which stores departure times as UTC wall-clock
 * values). This is the single source of truth for "today" used by the search
 * date constraints on both the client and the server schema, so the past-date
 * rule stays consistent across the two. Displaying flight times in an airport's
 * local timezone is tracked separately and would require per-airport timezone
 * data that the schema does not yet carry.
 */
export function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}
