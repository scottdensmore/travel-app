export interface FlightScheduleSummary {
    from: string;
    to: string;
    departureTime: string;
    daysOfWeek: number[];
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
