/** @jest-environment node */

import React from 'react';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        flight: { findMany: jest.fn() },
        flightSchedule: { findMany: jest.fn() },
    },
}));
jest.mock('@/components/ui/flightScheduleForm', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('@/components/ui/ManualOccurrenceBuilder', () => ({
    __esModule: true,
    default: (props: { schedules: Array<{ id: number }> }) => React.createElement('div', {
        'data-manual-schedule-ids': props.schedules.map(schedule => schedule.id).join(','),
    }),
}));
jest.mock('@/app/admin/flights/AdminFlightsTable', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('@/app/admin/flights/DeleteScheduleButton', () => ({
    __esModule: true,
    default: () => null,
}));

import AdminFlightsPage from '@/app/admin/flights/page';
import { prisma } from '@/lib/prisma';

const flightFindMany = prisma.flight.findMany as unknown as jest.Mock;
const scheduleFindMany = prisma.flightSchedule.findMany as unknown as jest.Mock;

function textContent(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!React.isValidElement(node)) return '';

    return React.Children.toArray(
        (node.props as { children?: React.ReactNode }).children,
    ).map(textContent).join(' ');
}

describe('/admin/flights schedule list', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        flightFindMany.mockResolvedValue([]);
        scheduleFindMany.mockResolvedValue([{
            id: 17,
            flightNumber: 'MA237',
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureTime: '08:00',
            durationMinutes: 245,
            daysOfWeek: [1, 3, 5],
            priceCents: 35_000,
            isActive: true,
        }, {
            id: 18,
            flightNumber: 'MA680',
            airline: 'Mona Airways',
            from: 'Tokyo, Japan',
            to: 'San Francisco, USA',
            departureTime: '17:00',
            durationMinutes: 680,
            daysOfWeek: [2, 4],
            priceCents: 120_000,
            isActive: false,
        }]);
    });

    it('shows the elapsed duration staff saved on each repeating template', async () => {
        const page = await AdminFlightsPage();
        const text = textContent(page);

        expect(text).toContain('Duration');
        expect(text).toContain('4h 05m');
        expect(text).toContain('11h 20m');
        expect(text).toContain('Active');
        expect(text).toContain('Inactive');
        expect(findElement(
            page,
            element => element.props.href === '/admin/flights/schedules/17',
        )).toHaveProperty('props.children', 'Preview impact');
        expect(findElement(
            page,
            element => Array.isArray(element.props.schedules)
                && element.props.schedules.map((schedule: { id: number }) => schedule.id).join(',') === '17',
        )).not.toBeNull();
    });

    it('spans every schedule column when there are no templates', async () => {
        scheduleFindMany.mockResolvedValue([]);

        const page = await AdminFlightsPage();
        const emptyCell = findElement(
            page,
            element => element.type === 'td' && textContent(element).includes('No flight templates declared yet.'),
        );

        expect(emptyCell?.props.colSpan).toBe(7);
    });
});

function findElement(
    node: React.ReactNode,
    predicate: (element: React.ReactElement) => boolean,
): React.ReactElement | null {
    if (!React.isValidElement(node)) return null;
    if (predicate(node)) return node;

    const children = React.Children.toArray(
        (node.props as { children?: React.ReactNode }).children,
    );
    for (const child of children) {
        const found = findElement(child, predicate);
        if (found) return found;
    }
    return null;
}
