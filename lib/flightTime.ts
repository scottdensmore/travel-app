import { airportTimeZoneFor } from './airports';

/**
 * When a flight leaves, in the only two forms that are ever correct: an instant
 * to compare, and an airport's local reading to show.
 *
 * `Flight.departureDate` used to be neither. `FlightScheduleService` built it
 * from the schedule's local time with a `Z` stapled on -- 08:00 in Tokyo stored
 * as 08:00Z, which is 17:00 in Tokyo -- and every screen rendered it with
 * `toLocaleDateString()`, in whatever timezone the viewer's browser happened to
 * be in. Two errors that cancel only for a viewer in UTC looking at a UTC
 * airport, which is why they survived so long (#84).
 *
 * The comparisons cared as much as the displays. #76's cancellation guard
 * refuses a booking whose flight has departed; east of UTC it was wrong by the
 * origin's offset, leaving hours in which a flown flight could still be
 * cancelled -- releasing a seat that was used and taking back the points for a
 * trip the customer took.
 *
 * Everything here goes through `Intl`, which carries the IANA database and its
 * history of transitions, so a fixed offset per airport is never assumed.
 */

/**
 * How far the zone is from UTC at a given instant, in milliseconds.
 *
 * Read by asking `Intl` what the wall clock says there and subtracting: there
 * is no API that answers directly, and hard-coding offsets would be wrong twice
 * a year for most of the world.
 */
function zoneOffsetMs(timeZone: string, instant: Date): number {
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

    const at = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find(part => part.type === type)!.value);

    // `hour` comes back as 24 at midnight under hour12: false, which Date.UTC
    // rolls into the next day -- correct arithmetic, wrong day.
    const asIfUtc = Date.UTC(
        at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'),
    );
    return asIfUtc - instant.getTime();
}

/**
 * The instant at which a wall clock reads `date` `time` at that airport.
 *
 * Two passes, because the offset depends on the instant and the instant depends
 * on the offset. The first pass guesses using the offset in force at the same
 * wall clock read as UTC; the second corrects it using the offset actually in
 * force at the guessed instant. That is exact everywhere except inside a
 * daylight-saving transition, where the answer is a choice rather than a fact:
 *
 *   * A wall clock the change *skips* (02:30 on a spring-forward morning) never
 *     happens. This lands just after the gap rather than throwing -- a schedule
 *     that names it is a data problem, not a reason to fail a page.
 *   * A wall clock the change *repeats* (01:30 on an autumn morning) happens
 *     twice. This takes the earlier, which is the conventional reading and the
 *     only one a schedule can mean without saying which.
 */
export function airportLocalInstant(date: string, time: string, timeZone: string): Date {
    const asIfUtc = Date.parse(`${date}T${time}:00.000Z`);
    if (Number.isNaN(asIfUtc)) {
        throw new Error(`Not a date and time this can read: ${date} ${time}`);
    }

    const firstGuess = new Date(asIfUtc - zoneOffsetMs(timeZone, new Date(asIfUtc)));
    const corrected = new Date(asIfUtc - zoneOffsetMs(timeZone, firstGuess));

    // The correction is right whenever the wall clock exists. When it does not
    // -- the hour a spring-forward skips -- the two passes disagree, and the
    // later of them is the one past the gap. Which pass that is depends on the
    // sign of the offset: taking `firstGuess` unconditionally shifts forward
    // west of UTC and *backward* everywhere else, reporting a departure earlier
    // than any instant the schedule could name. London is close enough to the
    // meridian to make that reachable from the airport data as it stands.
    if (departureInOriginZone(corrected, timeZone).time === time) return corrected;
    return new Date(Math.max(firstGuess.getTime(), corrected.getTime()));
}

/**
 * The instants bounding a calendar day at an airport, as `[start, end)`.
 *
 * A customer searching for the 16th means the 16th where they are standing.
 * With departures stored as instants, a UTC day is the wrong window whenever
 * the origin's local date differs from the UTC one: a 22:00 Miami departure is
 * 02:00Z the next day, so a UTC-day query missed it on every single occurrence
 * and the route could not be booked at all (#84).
 *
 * Half-open, because a closed upper bound has to name the last representable
 * millisecond and a day is not always 24 hours long anyway -- a daylight-saving
 * day is 23 or 25.
 */
export function airportDayBounds(date: string, timeZone: string | null | undefined): {
    start: Date;
    end: Date;
} {
    const zone = timeZone ?? 'UTC';
    const nextDay = new Date(`${date}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    return {
        start: airportLocalInstant(date, '00:00', zone),
        end: airportLocalInstant(nextDay.toISOString().slice(0, 10), '00:00', zone),
    };
}

/**
 * A flight's departure, read at the airport it leaves from.
 *
 * The convenience form for rendering: takes the route label the flight already
 * carries and looks its zone up, so no screen has to remember to. Every screen
 * used `toLocaleDateString()` before, which renders in whatever timezone the
 * viewer's browser is set to -- so the same flight read differently depending
 * on where the person looking at it happened to be sitting, which #84's
 * acceptance criteria rule out.
 */
export function flightDeparture(flight: {
    departureDate: Date | string;
    from: string;
}): LocalDeparture {
    return departureInOriginZone(flight.departureDate, airportTimeZoneFor(flight.from));
}

/** A departure as the airport it leaves from sees it. */
export interface LocalDeparture {
    /** `YYYY-MM-DD` at the origin, for comparing and for date inputs. */
    date: string;
    /** `HH:MM` on the origin's 24-hour clock. */
    time: string;
    /** `Aug 16, 2026`, for reading. */
    readableDate: string;
    /** `PDT`, `GMT+9` -- whatever that zone was called at that instant. */
    zoneLabel: string;
}

const READABLE_DATE: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
};

/**
 * A departure instant, read in the origin airport's timezone.
 *
 * `timeZone` is null for a place with no airport record, which falls back to
 * UTC -- the same answer the application gave everywhere before, and a
 * degradation rather than a failure.
 *
 * The zone label matters as much as the time. A bare "08:00" on a booking is
 * not information: the customer cannot tell whose clock it is on, and for an
 * international leg the answer is rarely theirs.
 */
export function departureInOriginZone(
    departure: Date | string,
    timeZone: string | null | undefined,
): LocalDeparture {
    const instant = departure instanceof Date ? departure : new Date(departure);
    const zone = timeZone ?? 'UTC';

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(instant);
    const at = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find(part => part.type === type)!.value;

    const hour = String(Number(at('hour')) % 24).padStart(2, '0');

    return {
        date: `${at('year')}-${at('month')}-${at('day')}`,
        time: `${hour}:${at('minute')}`,
        readableDate: new Intl.DateTimeFormat('en-US', { ...READABLE_DATE, timeZone: zone })
            .format(instant),
        zoneLabel: new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
            .formatToParts(instant)
            .find(part => part.type === 'timeZoneName')!.value,
    };
}
