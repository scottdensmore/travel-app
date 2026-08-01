import { millisecondsUntilNextLocalDay } from '@/lib/dates';
import {
    MAX_BOOKING_LEAD_DAYS,
    MIN_BOOKING_LEAD_DAYS,
    earliestBookableDateIso,
    latestBookableDateIso,
} from '@/lib/dates';

describe('booking window dates', () => {
    afterEach(() => jest.useRealTimers());

    it('defines an inclusive same-day through 365-day booking window', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T23:59:59.000Z'));

        expect(MIN_BOOKING_LEAD_DAYS).toBe(0);
        expect(MAX_BOOKING_LEAD_DAYS).toBe(365);
        expect(earliestBookableDateIso()).toBe('2026-07-14');
        expect(latestBookableDateIso()).toBe('2027-07-14');
    });
});

describe('millisecondsUntilNextLocalDay', () => {
    const anHour = 60 * 60 * 1000;

    it('counts to the UTC day boundary when no origin zone is known', () => {
        expect(millisecondsUntilNextLocalDay(undefined, new Date('2026-06-25T23:00:00Z')))
            .toBe(anHour);
    });

    it('counts to the origin airport midnight, not the UTC one', () => {
        // 14:00 UTC is 23:00 in Tokyo, so the day rolls over in an hour there
        // but not for another ten hours in UTC.
        expect(millisecondsUntilNextLocalDay('Asia/Tokyo', new Date('2026-06-25T14:00:00Z')))
            .toBe(anHour);
        // 06:00 UTC is 23:00 the previous evening in Los Angeles on PDT.
        expect(millisecondsUntilNextLocalDay('America/Los_Angeles', new Date('2026-06-25T06:00:00Z')))
            .toBe(anHour);
    });

    it('follows daylight saving rather than a fixed offset', () => {
        // New York is UTC-4 on EDT and UTC-5 on EST, so the same UTC clock time
        // sits a different distance from local midnight.
        expect(millisecondsUntilNextLocalDay('America/New_York', new Date('2026-07-01T03:00:00Z')))
            .toBe(anHour);
        expect(millisecondsUntilNextLocalDay('America/New_York', new Date('2026-01-01T04:00:00Z')))
            .toBe(anHour);
    });

    it('always lands within the coming day', () => {
        for (const zone of ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/London', 'America/Sao_Paulo']) {
            const remaining = millisecondsUntilNextLocalDay(zone, new Date('2026-06-25T12:34:56Z'));
            expect(remaining).toBeGreaterThan(0);
            expect(remaining).toBeLessThanOrEqual(24 * anHour);
        }
    });
});
