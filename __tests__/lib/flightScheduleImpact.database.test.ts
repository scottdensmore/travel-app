/** @jest-environment node */

import { randomUUID } from 'crypto';
import { FlightScheduleImpactService } from '@/lib/flightScheduleImpact';
import { prisma } from '@/lib/prisma';
import { holdSeats } from '@/lib/seatHolds';

describe('schedule impact preview in PostgreSQL', () => {
    const created = {
        scheduleIds: [] as number[],
        flightIds: [] as number[],
        bookingIds: [] as number[],
    };

    afterEach(async () => {
        await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
        await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
        await prisma.flightSchedule.deleteMany({ where: { id: { in: created.scheduleIds } } });
        created.scheduleIds.length = 0;
        created.flightIds.length = 0;
        created.bookingIds.length = 0;
    });

    it('returns only linked occurrences in mutually exclusive protection categories', async () => {
        const suffix = randomUUID().slice(0, 6).toUpperCase();
        const schedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: `I${suffix}`,
                airline: 'Impact Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1],
                priceCents: 35_000,
            },
        });
        created.scheduleIds.push(schedule.id);

        const now = new Date();
        const createFlight = async (
            offsetHours: number,
            status: 'ON_TIME' | 'DELAYED' = 'ON_TIME',
            linked = true,
        ) => {
            const flight = await prisma.flight.create({
                data: {
                    flightNumber: `${schedule.flightNumber}-${offsetHours}`,
                    airline: schedule.airline,
                    fromAirportCode: 'SEA',
                    toAirportCode: 'DTW',
                    departureDate: new Date(now.getTime() + offsetHours * 60 * 60 * 1_000),
                    durationMinutes: schedule.durationMinutes,
                    priceCents: schedule.priceCents,
                    status,
                    flightScheduleId: linked ? schedule.id : null,
                },
            });
            created.flightIds.push(flight.id);
            return flight;
        };

        const historical = await createFlight(-1);
        const booked = await createFlight(72);
        const held = await createFlight(96);
        const delayed = await createFlight(120, 'DELAYED');
        const safe = await createFlight(144);
        await createFlight(168, 'ON_TIME', false);

        const booking = await prisma.booking.create({
            data: { legs: { create: [{ sequence: 1, flightId: booked.id }] } },
        });
        created.bookingIds.push(booking.id);
        await holdSeats([{
            flightId: held.id,
            seatNumber: '11A',
            holderKey: `impact:${suffix}`,
        }]);

        const impact = await new FlightScheduleImpactService().forSchedule(schedule.id);

        expect(impact?.occurrences.map(occurrence => ({
            id: occurrence.id,
            eligibility: occurrence.eligibility,
            bookingIds: occurrence.bookingIds,
            hasActiveCheckout: occurrence.hasActiveCheckout,
        }))).toEqual([
            { id: historical.id, eligibility: 'HISTORICAL', bookingIds: [], hasActiveCheckout: false },
            { id: booked.id, eligibility: 'BOOKING_HISTORY', bookingIds: [booking.id], hasActiveCheckout: false },
            { id: held.id, eligibility: 'ACTIVE_CHECKOUT', bookingIds: [], hasActiveCheckout: true },
            { id: delayed.id, eligibility: 'OPERATIONAL_OVERRIDE', bookingIds: [], hasActiveCheckout: false },
            { id: safe.id, eligibility: 'SAFE_FUTURE', bookingIds: [], hasActiveCheckout: false },
        ]);
        expect(impact?.summary).toEqual({
            total: 5,
            safeFuture: 1,
            protected: 4,
            historical: 1,
            bookingHistory: 1,
            activeCheckout: 1,
            operationalOverride: 1,
        });
    });
});
