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
