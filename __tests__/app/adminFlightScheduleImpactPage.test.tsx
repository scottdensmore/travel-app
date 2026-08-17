/** @jest-environment node */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const forSchedule = jest.fn();

jest.mock('@/lib/flightScheduleImpact', () => ({
    FlightScheduleImpactService: jest.fn().mockImplementation(() => ({ forSchedule })),
}));
jest.mock('next/navigation', () => ({
    notFound: jest.fn(() => {
        throw new Error('NEXT_NOT_FOUND');
    }),
}));
jest.mock('@/components/ui/FlightScheduleTermsForm', () => ({
    __esModule: true,
    default: (props: Record<string, number>) => React.createElement('div', {
        'data-schedule-id': props.flightScheduleId,
        'data-duration-minutes': props.durationMinutes,
        'data-price-cents': props.priceCents,
        'data-safe-future-count': props.safeFutureCount,
        'data-protected-count': props.protectedCount,
    }),
}));

import ScheduleImpactPage from '@/app/admin/flights/schedules/[scheduleId]/page';

function findElements(
    node: React.ReactNode,
    predicate: (element: React.ReactElement) => boolean,
): React.ReactElement[] {
    if (!React.isValidElement(node)) return [];
    const matches = predicate(node) ? [node] : [];
    const children = React.Children.toArray(
        (node.props as { children?: React.ReactNode }).children,
    );
    return matches.concat(children.flatMap(child => findElements(child, predicate)));
}

describe('/admin/flights/schedules/[scheduleId] impact preview', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        forSchedule.mockResolvedValue({
            asOf: new Date('2026-08-17T12:00:00.000Z'),
            schedule: {
                id: 17,
                flightNumber: 'MA237',
                airline: 'Mona Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                durationMinutes: 245,
                priceCents: 35_000,
            },
            summary: {
                total: 5,
                safeFuture: 1,
                protected: 4,
                historical: 1,
                bookingHistory: 1,
                activeCheckout: 1,
                operationalOverride: 1,
            },
            occurrences: [
                { ...occurrence(71, '2026-08-16T15:00:00.000Z', 'HISTORICAL'), durationMinutes: null },
                occurrence(72, '2026-08-18T15:00:00.000Z', 'BOOKING_HISTORY', [91]),
                occurrence(73, '2026-08-19T15:00:00.000Z', 'ACTIVE_CHECKOUT', [], true),
                occurrence(74, '2026-08-20T15:00:00.000Z', 'OPERATIONAL_OVERRIDE', [], false, 'DELAYED'),
                occurrence(75, '2026-08-21T15:00:00.000Z', 'SAFE_FUTURE'),
            ],
        });
    });

    it('shows a read-only, occurrence-by-occurrence eligibility preview', async () => {
        const page = await ScheduleImpactPage({
            params: Promise.resolve({ scheduleId: '17' }),
        });
        const text = renderToStaticMarkup(page)
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ');

        expect(forSchedule).toHaveBeenCalledWith(17);
        expect(text).toContain('Schedule impact preview');
        expect(text).toContain('Mona Airways MA237');
        expect(text).toContain('Impact preview');
        expect(text).toContain('Nothing changes until you confirm the duration and fare update below.');
        expect(text).toContain('1 safe future');
        expect(text).toContain('4 protected');
        expect(text).toContain('1 historical');
        expect(text).toContain('1 with booking history');
        expect(text).toContain('1 in an active checkout');
        expect(text).toContain('1 with an operational override');
        expect(text).not.toContain('protecteds');
        expect(text).not.toContain('historicals');
        expect(text).toContain('Booking #91');
        expect(text).toContain('Active checkout');
        expect(text).toContain('Safe future');
        expect(text).toContain('Duration unavailable');
        expect(text).not.toContain('0h 00m');
        expect(text).toContain('Only occurrences with durable provenance for this template are included.');

        const termsForms = findElements(
            page,
            element => element.props.flightScheduleId === 17
                && element.props.safeFutureCount === 1,
        );
        expect(termsForms).toHaveLength(1);
        expect(termsForms[0].props).toMatchObject({
            durationMinutes: 245,
            priceCents: 35_000,
            safeFutureCount: 1,
            protectedCount: 4,
        });

        const bookingRow = findElements(
            page,
            element => element.type === 'tr'
                && renderToStaticMarkup(element).includes('Booking #91'),
        );
        expect(bookingRow).toHaveLength(1);
        expect(renderToStaticMarkup(bookingRow[0])).toContain('Booking history');

        const backLinks = findElements(
            page,
            element => element.props.href === '/admin/flights',
        );
        expect(backLinks).toHaveLength(1);
    });

    it.each([
        'not-a-number',
        '0',
        '-2',
        '17.5',
        '1e2',
        '0x11',
        ' 17 ',
        '+17',
        '017',
    ])('rejects invalid schedule id %s', async scheduleId => {
        await expect(ScheduleImpactPage({
            params: Promise.resolve({ scheduleId }),
        })).rejects.toThrow('NEXT_NOT_FOUND');
        expect(forSchedule).not.toHaveBeenCalled();
    });

    it('shows a valid template whose durable provenance has no occurrences', async () => {
        forSchedule.mockResolvedValue({
            asOf: new Date('2026-08-17T12:00:00.000Z'),
            schedule: {
                id: 17,
                flightNumber: 'MA237',
                airline: 'Mona Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                durationMinutes: 245,
                priceCents: 35_000,
            },
            summary: {
                total: 0,
                safeFuture: 0,
                protected: 0,
                historical: 0,
                bookingHistory: 0,
                activeCheckout: 0,
                operationalOverride: 0,
            },
            occurrences: [],
        });

        const page = await ScheduleImpactPage({
            params: Promise.resolve({ scheduleId: '17' }),
        });
        const emptyCells = findElements(
            page,
            element => element.type === 'td'
                && renderToStaticMarkup(element).includes('No linked occurrences exist for this template.'),
        );

        expect(emptyCells).toHaveLength(1);
        expect(emptyCells[0].props.colSpan).toBe(5);
    });

    it('returns not found when no schedule owns the requested preview', async () => {
        forSchedule.mockResolvedValue(null);

        await expect(ScheduleImpactPage({
            params: Promise.resolve({ scheduleId: '404' }),
        })).rejects.toThrow('NEXT_NOT_FOUND');
        expect(forSchedule).toHaveBeenCalledWith(404);
    });
});

function occurrence(
    id: number,
    departureDate: string,
    eligibility: 'HISTORICAL' | 'BOOKING_HISTORY' | 'ACTIVE_CHECKOUT' | 'OPERATIONAL_OVERRIDE' | 'SAFE_FUTURE',
    bookingIds: number[] = [],
    hasActiveCheckout = false,
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' = 'ON_TIME',
) {
    return {
        id,
        flightNumber: 'MA237',
        airline: 'Mona Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date(departureDate),
        durationMinutes: 245,
        priceCents: 35_000,
        status,
        bookingIds,
        hasActiveCheckout,
        eligibility,
    };
}
