/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import {
    airportLocalInstant,
    arrivalInstant,
    departureInOriginZone,
    durationLabel,
    flightArrival,
} from '@/lib/flightTime';

const repositoryRoot = path.resolve(__dirname, '../..');

/**
 * Turning an airport's wall clock into an instant, and back again for display.
 *
 * `Flight.departureDate` was neither. `FlightScheduleService` built it as the
 * schedule's local time with a `Z` stapled on -- 08:00 in Tokyo stored as
 * 08:00Z, which is 17:00 in Tokyo -- and every screen then rendered it with
 * `toLocaleDateString()`, in whatever timezone the viewer's browser happened to
 * be in. Two errors that cancel only for a viewer sitting in UTC looking at a
 * UTC airport (#84).
 *
 * The comparisons cared as much as the displays: the cancellation guard added
 * in #76 refuses a booking whose flight has departed, and east of UTC it was
 * wrong by the origin's offset -- nine hours during which a flown flight could
 * still be cancelled.
 */
describe('an airport wall clock becomes an instant', () => {
    it('reads a time as local to the airport, not as UTC', () => {
        // 08:00 in Tokyo is 23:00 the previous day in UTC. Stapling a Z on
        // gave 08:00Z, nine hours late and, for this flight, the wrong day.
        expect(airportLocalInstant('2026-08-16', '08:00', 'Asia/Tokyo').toISOString())
            .toBe('2026-08-15T23:00:00.000Z');
    });

    it('handles a zone behind UTC', () => {
        // Seattle in August is UTC-7.
        expect(airportLocalInstant('2026-08-16', '08:00', 'America/Los_Angeles').toISOString())
            .toBe('2026-08-16T15:00:00.000Z');
    });

    it('is the identity for UTC itself', () => {
        expect(airportLocalInstant('2026-08-16', '08:00', 'UTC').toISOString())
            .toBe('2026-08-16T08:00:00.000Z');
    });

    it('follows the zone across a daylight-saving change', () => {
        // The same wall clock either side of the US autumn transition is a
        // different instant, and a single fixed offset gets one of them wrong.
        expect(airportLocalInstant('2026-10-30', '08:00', 'America/New_York').toISOString())
            .toBe('2026-10-30T12:00:00.000Z');
        expect(airportLocalInstant('2026-11-05', '08:00', 'America/New_York').toISOString())
            .toBe('2026-11-05T13:00:00.000Z');
    });

    it('resolves a wall clock that daylight saving skips', () => {
        // 02:30 on the spring-forward morning never happens in New York. There
        // is no right answer, only a defined one: it must not throw, and it
        // must land on a real instant near the gap.
        const instant = airportLocalInstant('2026-03-08', '02:30', 'America/New_York');

        expect(Number.isNaN(instant.getTime())).toBe(false);
        expect(instant.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    });

    it('resolves a wall clock daylight saving repeats', () => {
        // 01:30 happens twice on the autumn morning. The earlier of the two is
        // the conventional reading, and the only one a schedule could mean
        // without saying which.
        expect(airportLocalInstant('2026-11-01', '01:30', 'America/New_York').toISOString())
            .toBe('2026-11-01T05:30:00.000Z');
    });

    it('corrects the guess on the day of a transition', () => {
        // The second pass is the whole function. A single guess is wrong by an
        // hour for roughly the offset's width after a change, and deleting the
        // correction left every other test here green.
        expect(airportLocalInstant('2026-11-01', '03:00', 'America/New_York').toISOString())
            .toBe('2026-11-01T08:00:00.000Z');
        expect(airportLocalInstant('2026-03-08', '04:00', 'America/New_York').toISOString())
            .toBe('2026-03-08T08:00:00.000Z');
        expect(airportLocalInstant('2026-04-04', '18:00', 'Australia/Sydney').toISOString())
            .toBe('2026-04-04T07:00:00.000Z');
    });

    it('shifts a skipped wall clock forward whichever side of UTC the zone is', () => {
        // Taking the first guess unconditionally shifts forward west of UTC and
        // backward everywhere else -- reporting a departure earlier than any
        // instant the schedule could name. London is reachable from the airport
        // data as it stands.
        for (const [zone, date, time] of [
            ['America/New_York', '2026-03-08', '02:30'],
            ['Europe/London', '2026-03-29', '01:30'],
            ['Australia/Sydney', '2026-10-04', '02:30'],
        ] as const) {
            const instant = airportLocalInstant(date, time, zone);
            const readBack = departureInOriginZone(instant, zone);
            expect({ zone, reads: readBack.time > time }).toEqual({ zone, reads: true });
        }
    });

    it('is exactly reversible for an ordinary time', () => {
        for (const zone of ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/London', 'UTC']) {
            const instant = airportLocalInstant('2026-06-15', '14:45', zone);
            expect(departureInOriginZone(instant, zone).time).toBe('14:45');
        }
    });
});

describe('and an instant reads back as the airport saw it', () => {
    const tokyoDeparture = new Date('2026-08-15T23:00:00.000Z');

    it('gives the date and time at the origin, not at the viewer', () => {
        // The whole point: this is 15 August in UTC and 16 August in Tokyo,
        // and the flight leaves on the 16th.
        expect(departureInOriginZone(tokyoDeparture, 'Asia/Tokyo')).toMatchObject({
            date: '2026-08-16',
            time: '08:00',
        });
    });

    it('names the zone, so the time is not just a number', () => {
        // A customer cannot tell which clock a bare "08:00" is on.
        expect(departureInOriginZone(tokyoDeparture, 'Asia/Tokyo').zoneLabel).toBe('GMT+9');
        expect(departureInOriginZone(new Date('2026-08-16T15:00:00.000Z'), 'America/Los_Angeles').zoneLabel)
            .toBe('PDT');
    });

    it('reports the zone that was in force, not the one in force now', () => {
        // Same airport, either side of a transition.
        const summer = departureInOriginZone(new Date('2026-08-16T12:00:00.000Z'), 'America/New_York');
        const winter = departureInOriginZone(new Date('2026-12-16T13:00:00.000Z'), 'America/New_York');

        expect(summer.zoneLabel).toBe('EDT');
        expect(winter.zoneLabel).toBe('EST');
    });

    it('formats a date a customer would recognise', () => {
        expect(departureInOriginZone(tokyoDeparture, 'Asia/Tokyo').readableDate)
            .toBe('Aug 16, 2026');
    });

    it('falls back to UTC when the zone is unknown rather than throwing', () => {
        // A place with no airport record should degrade to the old behaviour,
        // not take a page down.
        expect(departureInOriginZone(tokyoDeparture, null)).toMatchObject({
            date: '2026-08-15',
            time: '23:00',
        });
    });
});

describe('no screen renders a departure in the viewer\'s timezone', () => {
    // Textual, and worth it: `toLocaleDateString()` on a departure is exactly
    // the mistake #84 exists to remove, it reads as ordinary code, and it was
    // in ten places. A component test can only speak for the component it
    // renders; this speaks for the ones nobody has written yet.
    const sourceFiles = (directory: string): string[] =>
        fs.readdirSync(path.resolve(repositoryRoot, directory), { withFileTypes: true })
            .flatMap((entry) => {
                const next = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    return entry.name === 'node_modules' || entry.name.startsWith('.')
                        ? []
                        : sourceFiles(next);
                }
                return /\.tsx?$/.test(entry.name) ? [next] : [];
            });

    it('formats it through lib/flightTime instead', () => {
        // Any formatting of a departure without a timeZone, however it is
        // spelled: straight through, via a local, or through Intl by another
        // name. `lib` is scanned too -- a formatter landing there was invisible
        // before, and `lib` already formats other dates this way.
        const offenders = ['app', 'components', 'lib']
            .flatMap(sourceFiles)
            .filter((file) => file !== path.join('lib', 'flightTime.ts'))
            .filter((file) => {
                const source = fs.readFileSync(path.resolve(repositoryRoot, file), 'utf8');
                if (/departureDate/.test(source) === false) return false;
                // A departure reaching a formatter, directly or through a local
                // assigned from it.
                const named = source.match(/(?:const|let)\s+(\w+)\s*=\s*new Date\([^)]*departureDate[^)]*\)/g) ?? [];
                const locals = named.map(match => /(?:const|let)\s+(\w+)/.exec(match)![1]);
                return /new Date\([^)]*departureDate[^)]*\)\s*\.toLocale/.test(source)
                    || /departureDate\s*\)?\.toLocale/.test(source)
                    || /Intl\.DateTimeFormat\(\s*\)[\s\S]{0,40}departureDate/.test(source)
                    || locals.some(local => new RegExp(`\\b${local}\\.toLocale`).test(source));
            });

        expect(offenders).toEqual([]);
    });
});

describe('when a flight lands', () => {
    /**
     * The reason the duration is stored rather than the arrival derived from
     * two local times: across a timezone, subtracting them is not a duration.
     * Tokyo to San Francisco lands hours *earlier* by the clock than it left,
     * and a shorter New York to London hop lands the next day.
     */
    it('is the departure plus the elapsed minutes, whatever the zones', () => {
        expect(arrivalInstant('2026-08-16T15:00:00.000Z', 680).toISOString())
            .toBe('2026-08-17T02:20:00.000Z');
    });

    it('reads at the destination, with no day marker for an ordinary hop', () => {
        // Seattle 08:00 PDT, 4h05 to Detroit: lands 15:05 EDT the same day.
        const arrival = flightArrival({
            departureDate: airportLocalInstant('2026-08-17', '08:00', 'America/Los_Angeles'),
            durationMinutes: 245,
            from: 'Seattle, USA',
            to: 'Detroit, USA',
        });

        expect(arrival).toMatchObject({ date: '2026-08-17', time: '15:05', dayOffset: 0 });
    });

    it('marks the next day for an overnight crossing', () => {
        // New York 19:30 EDT, 7h to London: lands 07:30 BST the next morning.
        const arrival = flightArrival({
            departureDate: airportLocalInstant('2026-08-17', '19:30', 'America/New_York'),
            durationMinutes: 420,
            from: 'New York, USA',
            to: 'London, UK',
        });

        expect(arrival).toMatchObject({ date: '2026-08-18', time: '07:30', dayOffset: 1 });
    });

    it('marks a day gained crossing the date line westward', () => {
        // San Francisco 11:00 PDT, 11h20 to Tokyo: lands the *following* day
        // despite taking less than a day.
        const arrival = flightArrival({
            departureDate: airportLocalInstant('2026-08-17', '11:00', 'America/Los_Angeles'),
            durationMinutes: 680,
            from: 'San Francisco, USA',
            to: 'Tokyo, Japan',
        });

        expect(arrival.dayOffset).toBe(1);
    });

    it('lands on the same date it left coming the other way', () => {
        // Tokyo 15:00 JST, 9h35 to San Francisco: arrives 08:35 the same
        // calendar date, having "gone back" in local time. Subtracting the two
        // clocks would report minus six hours.
        const arrival = flightArrival({
            departureDate: airportLocalInstant('2026-08-17', '15:00', 'Asia/Tokyo'),
            durationMinutes: 575,
            from: 'Tokyo, Japan',
            to: 'San Francisco, USA',
        });

        expect(arrival).toMatchObject({ date: '2026-08-17', time: '08:35', dayOffset: 0 });
    });

    it('counts the day marker in calendar days, not in elapsed time', () => {
        // A 4h05 hop that leaves at 23:00 lands the next day; a 9h35 crossing
        // can land the same day. Elapsed time cannot tell you which.
        const lateHop = flightArrival({
            departureDate: airportLocalInstant('2026-08-17', '23:00', 'America/Los_Angeles'),
            durationMinutes: 245,
            from: 'Seattle, USA',
            to: 'Detroit, USA',
        });

        expect(lateHop.dayOffset).toBe(1);
    });

    it('marks a landing on an earlier date crossing the line eastward', () => {
        // Tokyo before about 06:25 lands the *previous* calendar date in San
        // Francisco. It is the row a reader most needs the marker on -- the
        // arrival otherwise looks like a mistake -- and admin-authored data
        // reaches it even though the seed does not.
        const arrival = flightArrival({
            departureDate: airportLocalInstant('2026-08-17', '00:30', 'Asia/Tokyo'),
            durationMinutes: 575,
            from: 'Tokyo, Japan',
            to: 'San Francisco, USA',
        });

        expect(arrival).toMatchObject({ date: '2026-08-16', dayOffset: -1 });
    });

    it('states elapsed time the way a timetable does', () => {
        expect(durationLabel(245)).toBe('4h 05m');
        expect(durationLabel(680)).toBe('11h 20m');
        expect(durationLabel(60)).toBe('1h 00m');
    });
});
