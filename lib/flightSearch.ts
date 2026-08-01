import { addDaysToIsoDate, bookingWindowIsoDates } from '@/lib/dates';

export interface FlightScheduleSummary {
    from: string;
    to: string;
    departureTime: string;
    daysOfWeek: number[];
}

export interface OperatingScheduleSummary {
    flightNumber: string;
    departureTime: string;
    daysOfWeek: number[];
}

export interface CancelledFlightSummary {
    flightNumber: string;
    departureDate: Date;
}

export interface FlightRoute {
    from: string;
    to: string;
    nextOperatingDate: string;
}

function getNextDeparture(
    schedule: FlightScheduleSummary,
    now: Date,
): Date | null {
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(schedule.departureTime);
    if (!timeMatch) return null;

    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;

    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
        const candidate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + dayOffset,
            hours,
            minutes,
        ));

        if (
            schedule.daysOfWeek.includes(candidate.getUTCDay())
            && candidate.getTime() > now.getTime()
        ) {
            return candidate;
        }
    }

    return null;
}

export function buildFlightRoutes(
    schedules: FlightScheduleSummary[],
    now = new Date(),
): FlightRoute[] {
    const routes = new Map<string, { route: FlightRoute; nextDeparture: Date }>();

    for (const schedule of schedules) {
        const nextDeparture = getNextDeparture(schedule, now);
        if (!nextDeparture) continue;

        const key = `${schedule.from}\u0000${schedule.to}`;
        const current = routes.get(key);
        if (current && current.nextDeparture <= nextDeparture) continue;

        routes.set(key, {
            route: {
                from: schedule.from,
                to: schedule.to,
                nextOperatingDate: nextDeparture.toISOString().slice(0, 10),
            },
            nextDeparture,
        });
    }

    return Array.from(routes.values(), ({ route }) => route);
}

function hasFutureDepartureOnDate(
    schedules: OperatingScheduleSummary[],
    dateString: string,
    now: Date,
    cancelledDepartureKeys: ReadonlySet<string>,
): boolean {
    const day = new Date(`${dateString}T00:00:00.000Z`).getUTCDay();

    return schedules.some((schedule) => {
        if (!schedule.daysOfWeek.includes(day)) return false;
        const departure = new Date(`${dateString}T${schedule.departureTime}:00Z`);
        if (Number.isNaN(departure.getTime())) return false;
        const departureKey = `${schedule.flightNumber}\u0000${departure.toISOString()}`;
        return departure > now
            && !cancelledDepartureKeys.has(departureKey);
    });
}

export function findNearbyOperatingDates(
    schedules: OperatingScheduleSummary[],
    requestedDate: string,
    now = new Date(),
    cancelledFlights: CancelledFlightSummary[] = [],
    originTimeZone?: string | null,
): string[] {
    // Suggestions are bounded by the same window the search itself uses, which
    // is the origin airport's calendar day.
    const { earliestDate, latestDate } = bookingWindowIsoDates(now, originTimeZone);
    const cancelledDepartureKeys = new Set(cancelledFlights.map((flight) => (
        `${flight.flightNumber}\u0000${flight.departureDate.toISOString()}`
    )));
    let earlierDate: string | undefined;
    let laterDate: string | undefined;

    for (let offset = 1; offset <= 365 && (!earlierDate || !laterDate); offset += 1) {
        const earlierCandidate = addDaysToIsoDate(requestedDate, -offset);
        if (
            !earlierDate
            && earlierCandidate >= earliestDate
            && hasFutureDepartureOnDate(
                schedules,
                earlierCandidate,
                now,
                cancelledDepartureKeys,
            )
        ) {
            earlierDate = earlierCandidate;
        }

        const laterCandidate = addDaysToIsoDate(requestedDate, offset);
        if (
            !laterDate
            && laterCandidate <= latestDate
            && hasFutureDepartureOnDate(
                schedules,
                laterCandidate,
                now,
                cancelledDepartureKeys,
            )
        ) {
            laterDate = laterCandidate;
        }
    }

    return [earlierDate, laterDate].filter((date): date is string => Boolean(date));
}
