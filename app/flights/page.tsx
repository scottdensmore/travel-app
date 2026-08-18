import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/prisma';
import FlightStatusBoard from '@/components/ui/FlightStatusBoard';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { serverRenderTime } from '@/lib/serverClock';

export const metadata: Metadata = {
    title: 'Flight status',
    description: 'Check a Mona Airways flight\'s scheduled phase or airline-set status.',
};

export const dynamic = 'force-dynamic';

/**
 * How much of the schedule a status board is actually for.
 *
 * The query had no bound at all, so every flight ever scheduled was serialized
 * into the RSC payload on every request — 1420 rows spanning fifteen months
 * against the seeded data, on a page that answers "is my flight on time"
 * (#153). Sorted ascending, that also put the oldest departure at the top.
 *
 * The window opens in the past because a departure that has just left is still
 * a thing people check, and closes a week out to keep the board's own search
 * useful without reaching back toward the whole table.
 *
 * Two hours of history, not a day. Airline-set `Flight.status` does not advance
 * with the clock, so the board derives departed and arrived phases from the
 * same render instant that bounds this query. Against the seed:
 *
 *     history= 2h -> 28 rows, 1 recent departure
 *     history= 6h -> 30 rows, 3 recent departures
 *     history=24h -> 32 rows, 5 recent departures
 *
 * Two keeps recent departures answerable without turning the status page into
 * a historical timetable.
 */
const HISTORY_HOURS = 2;
const HORIZON_DAYS = 7;

/**
 * A ceiling for a schedule denser than the seed's. The window bounds this
 * comfortably today; `take` is what stops a real timetable from reintroducing
 * the same defect. Ascending order means it drops the furthest away, which is
 * the least useful end.
 */
const MAX_ROWS = 200;

/**
 * Durations rather than dates, deliberately.
 *
 * An absolute range has no single truthful timezone: each row belongs to the
 * airport it leaves from, and one board can span many origins and local dates.
 * A duration is relative to the same server instant everywhere, so the line
 * cannot contradict any correctly localised row.
 */
const count = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;

/**
 * Reading the clock is the impure part, so it lives here rather than in the
 * component body, where the React lint rule rightly objects to it. The page is
 * `force-dynamic`, so this runs per request and the window moves with it.
 */
function departureWindow(renderedAt: number): { start: Date; end: Date } {
    return {
        start: new Date(renderedAt - HISTORY_HOURS * 60 * 60 * 1000),
        end: new Date(renderedAt + HORIZON_DAYS * 24 * 60 * 60 * 1000),
    };
}

export default async function FlightsPage() {
    const renderedAt = await serverRenderTime();
    const { start: windowStart, end: windowEnd } = departureWindow(renderedAt);

    const flights = await prisma.flight.findMany({
        where: { departureDate: { gte: windowStart, lte: windowEnd } },
        orderBy: { departureDate: 'asc' },
        take: MAX_ROWS,
        // Only what the board renders. Without this the payload also carried
        // the four cabin row counts and the seat pattern, which nothing on this
        // page reads — 8.5KB against 5.5KB once the window has done its work.
        select: {
            id: true,
            flightNumber: true,
            airline: true,
            departureDate: true,
            // The board derives the arrival from this. Omitted, every row
            // silently loses its arrival line -- the same seam that hid a
            // released seat in #230, and one a component test cannot see
            // because it is handed props directly (#84).
            durationMinutes: true,
            priceCents: true,
            status: true,
            ...flightRouteInclude,
        },
    });

    // When the cap truncates, the board holds less than the window asked for,
    // so it must not claim the whole week — count departures instead of days.
    const routed = flights.map(withRouteLabels);
    const truncated = flights.length === MAX_ROWS;
    const coverage = `the last ${count(HISTORY_HOURS, 'hour')} and the next ${
        truncated ? count(flights.length, 'flight') : count(HORIZON_DAYS, 'day')
    }`;

    return <FlightStatusBoard flights={routed} renderedAt={renderedAt} coverage={coverage} />;
}
