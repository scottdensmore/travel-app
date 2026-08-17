import {
    accountTimeZoneChoices,
    formatAccountDateTime,
    normalizeAccountTimeZone,
} from '@/lib/accountTimeZone';

describe('customer account timezones', () => {
    it('canonicalizes a valid IANA timezone and rejects an invented one', () => {
        expect(normalizeAccountTimeZone(' US/Pacific ')).toBe('America/Los_Angeles');
        expect(normalizeAccountTimeZone('Not/AZone')).toBeNull();
        expect(normalizeAccountTimeZone('')).toBeNull();
    });

    it('offers the explicit UTC fallback alongside customer zones', () => {
        const choices = accountTimeZoneChoices();
        const supportedZones = Intl.supportedValuesOf('timeZone');

        expect(choices).toEqual([
            'UTC',
            ...supportedZones.filter(zone => zone !== 'UTC'),
        ]);
        expect(new Set(choices).size).toBe(choices.length);
    });

    it('labels an account instant in the chosen timezone', () => {
        const instant = new Date('2026-06-03T14:30:00.000Z');

        expect(formatAccountDateTime(instant, 'America/Los_Angeles'))
            .toBe('June 3, 2026 at 7:30 AM PDT');
        expect(formatAccountDateTime(instant, 'UTC'))
            .toBe('June 3, 2026 at 2:30 PM UTC');
        expect(formatAccountDateTime(instant, 'Not/AZone'))
            .toBe('June 3, 2026 at 2:30 PM UTC');
    });
});
