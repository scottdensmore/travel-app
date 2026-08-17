/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: jest.fn(),
        flightSchedule: { findUnique: jest.fn() },
    },
}));

import {
    FlightScheduleImpactService,
    classifyScheduleOccurrence,
    summarizeScheduleImpact,
} from '@/lib/flightScheduleImpact';
import { prisma } from '@/lib/prisma';

const queryClock = prisma.$queryRaw as unknown as jest.Mock;
const findSchedule = prisma.flightSchedule.findUnique as unknown as jest.Mock;
const asOf = new Date('2026-08-17T12:00:00.000Z');

describe('schedule edit impact policy', () => {
    it.each([
        {
            name: 'an occurrence at the preview boundary',
            occurrence: {
                departureDate: asOf,
                status: 'CANCELLED' as const,
                bookingIds: [88],
                hasActiveCheckout: true,
            },
            expected: 'HISTORICAL',
        },
        {
            name: 'a future occurrence with booking history',
            occurrence: {
                departureDate: new Date('2026-08-18T12:00:00.000Z'),
                status: 'ON_TIME' as const,
                bookingIds: [91],
                hasActiveCheckout: true,
            },
            expected: 'BOOKING_HISTORY',
        },
        {
            name: 'a future unbooked occurrence in an active checkout',
            occurrence: {
                departureDate: new Date('2026-08-18T12:00:00.000Z'),
                status: 'DELAYED' as const,
                bookingIds: [],
                hasActiveCheckout: true,
            },
            expected: 'ACTIVE_CHECKOUT',
        },
        {
            name: 'a future unbooked occurrence with an operational override',
            occurrence: {
                departureDate: new Date('2026-08-18T12:00:00.000Z'),
                status: 'DELAYED' as const,
                bookingIds: [],
                hasActiveCheckout: false,
            },
            expected: 'OPERATIONAL_OVERRIDE',
        },
        {
            name: 'a future unbooked cancelled occurrence',
            occurrence: {
                departureDate: new Date('2026-08-18T12:00:00.000Z'),
                status: 'CANCELLED' as const,
                bookingIds: [],
                hasActiveCheckout: false,
            },
            expected: 'OPERATIONAL_OVERRIDE',
        },
        {
            name: 'an untouched future occurrence',
            occurrence: {
                departureDate: new Date('2026-08-18T12:00:00.000Z'),
                status: 'ON_TIME' as const,
                bookingIds: [],
                hasActiveCheckout: false,
            },
            expected: 'SAFE_FUTURE',
        },
    ])('classifies $name as $expected', ({ occurrence, expected }) => {
        expect(classifyScheduleOccurrence(occurrence, asOf)).toBe(expected);
    });

    it('counts every occurrence in exactly one impact category', () => {
        expect(summarizeScheduleImpact([
            'SAFE_FUTURE',
            'SAFE_FUTURE',
            'HISTORICAL',
            'BOOKING_HISTORY',
            'ACTIVE_CHECKOUT',
            'OPERATIONAL_OVERRIDE',
        ])).toEqual({
            total: 6,
            safeFuture: 2,
            protected: 4,
            historical: 1,
            bookingHistory: 1,
            activeCheckout: 1,
            operationalOverride: 1,
        });
    });
});

describe('FlightScheduleImpactService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        queryClock.mockResolvedValue([{ now: asOf }]);
    });

    it('returns an explicit client-safe projection ordered by departure', async () => {
        findSchedule.mockResolvedValue({
            id: 17,
            flightNumber: 'MA237',
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            durationMinutes: 245,
            priceCents: 35_000,
            isActive: true,
            flights: [{
                id: 71,
                flightNumber: 'MA237',
                airline: 'Mona Airways',
                departureDate: new Date('2026-08-18T15:00:00.000Z'),
                durationMinutes: 245,
                priceCents: 35_000,
                status: 'ON_TIME',
                fromAirport: { label: 'Seattle, USA' },
                toAirport: { label: 'Detroit, USA' },
                itineraryLegs: [{ bookingId: 92 }, { bookingId: 91 }, { bookingId: 92 }],
                seatHolds: [{ id: 'live-hold' }],
            }],
        });

        const impact = await new FlightScheduleImpactService().forSchedule(17);

        expect(findSchedule).toHaveBeenCalledWith({
            where: { id: 17 },
            select: {
                id: true,
                flightNumber: true,
                airline: true,
                from: true,
                to: true,
                durationMinutes: true,
                priceCents: true,
                isActive: true,
                flights: {
                    orderBy: { departureDate: 'asc' },
                    select: {
                        id: true,
                        flightNumber: true,
                        airline: true,
                        departureDate: true,
                        durationMinutes: true,
                        priceCents: true,
                        status: true,
                        fromAirport: { select: { label: true } },
                        toAirport: { select: { label: true } },
                        itineraryLegs: { select: { bookingId: true } },
                        seatHolds: {
                            where: { expiresAt: { gt: asOf } },
                            select: { id: true },
                            take: 1,
                        },
                    },
                },
            },
        });
        expect(impact).toEqual({
            asOf,
            schedule: {
                id: 17,
                flightNumber: 'MA237',
                airline: 'Mona Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                durationMinutes: 245,
                priceCents: 35_000,
                isActive: true,
            },
            summary: {
                total: 1,
                safeFuture: 0,
                protected: 1,
                historical: 0,
                bookingHistory: 1,
                activeCheckout: 0,
                operationalOverride: 0,
            },
            occurrences: [{
                id: 71,
                flightNumber: 'MA237',
                airline: 'Mona Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: new Date('2026-08-18T15:00:00.000Z'),
                durationMinutes: 245,
                priceCents: 35_000,
                status: 'ON_TIME',
                bookingIds: [91, 92],
                hasActiveCheckout: true,
                eligibility: 'BOOKING_HISTORY',
            }],
        });
        expect(Object.keys(impact!.occurrences[0]).sort()).toEqual([
            'airline',
            'bookingIds',
            'departureDate',
            'durationMinutes',
            'eligibility',
            'flightNumber',
            'from',
            'hasActiveCheckout',
            'id',
            'priceCents',
            'status',
            'to',
        ]);
    });

    it('returns null rather than inventing a preview for a missing schedule', async () => {
        findSchedule.mockResolvedValue(null);

        await expect(new FlightScheduleImpactService().forSchedule(404)).resolves.toBeNull();
    });
});
