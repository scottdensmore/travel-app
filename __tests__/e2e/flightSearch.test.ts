/** @jest-environment node */

import { fillOneWayFlightSearch, flightSearchDate } from '@/e2e/helpers/flightSearch';

describe('Playwright flight search fixtures', () => {
    it('submits the departure date seen at the origin airport', () => {
        expect(flightSearchDate({
            // UTC and Rio are already on the 15th; Miami is still on the 14th.
            // This distinguishes the origin date from either tempting substitute.
            departureDate: new Date('2026-08-15T03:30:00.000Z'),
            fromAirport: { label: 'Miami, USA' },
            toAirport: { label: 'Rio de Janeiro, Brazil' },
        })).toBe('2026-08-14');
    });

    it('fills a one-way search from the selected database flight', async () => {
        const actions: string[] = [];
        const page = {
            getByLabel: (label: string) => ({
                click: async () => { actions.push(`click:${label}`); },
            }),
            selectOption: async (selector: string, value: string) => {
                actions.push(`select:${selector}:${value}`);
            },
            fill: async (selector: string, value: string) => {
                actions.push(`fill:${selector}:${value}`);
            },
        } as never;

        await fillOneWayFlightSearch(page, {
            departureDate: new Date('2026-08-15T03:30:00.000Z'),
            fromAirport: { label: 'Miami, USA' },
            toAirport: { label: 'Rio de Janeiro, Brazil' },
        });

        expect(actions).toEqual([
            'click:One Way',
            'select:#from:Miami, USA',
            'select:#to:Rio de Janeiro, Brazil',
            'fill:#depart:2026-08-14',
        ]);
    });
});
