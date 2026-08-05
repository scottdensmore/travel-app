import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/prisma';
import FlightStatusBoard from '@/components/ui/FlightStatusBoard';

export const metadata: Metadata = {
    title: 'Flight status',
    description: 'Check whether a Mona Airways flight is on time, delayed or cancelled.',
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
 * Two hours of history, not a day. Nothing advances `Flight.status` when a
 * flight leaves, so every row of history is a row asserting "On Time" about a
 * departure that has already gone — worse than being absent, because absent
 * reads as ambiguous and "On Time" reads as answered. Against the seed:
 *
 *     history= 2h -> 28 rows, 1 departed and badged On Time
 *     history= 6h -> 30 rows, 3
 *     history=24h -> 32 rows, 5
 *
 * Two keeps the case worth having — "did my flight actually leave?" — and
 * costs one misleading row until #84 marks a departed flight as departed.
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
 * An absolute range reads better — the reader is holding a booking with a date
 * on it — but it cannot be stated correctly yet. The rows format themselves in
 * the viewer's browser timezone, so a range formatted here would sit above rows
 * dated a day either side of it: an Auckland reader saw "covers to Aug 12"
 * above a row dated 13/08. Fixing that means displaying flight times in the
 * airport's timezone, which is #84's job and needs the airport reference it
 * introduces. A duration is relative to an instant, so it is the same sentence
 * everywhere.
 */
const count = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;

/**
 * Reading the clock is the impure part, so it lives here rather than in the
 * component body, where the React lint rule rightly objects to it. The page is
 * `force-dynamic`, so this runs per request and the window moves with it.
 */
function departureWindow(): { start: Date; end: Date } {
    const now = Date.now();
    return {
        start: new Date(now - HISTORY_HOURS * 60 * 60 * 1000),
        end: new Date(now + HORIZON_DAYS * 24 * 60 * 60 * 1000),
    };
}

export default async function FlightsPage() {
    const { start: windowStart, end: windowEnd } = departureWindow();

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
            from: true,
            to: true,
            departureDate: true,
            priceCents: true,
            status: true,
        },
    });

    // When the cap truncates, the board holds less than the window asked for,
    // so it must not claim the whole week — count departures instead of days.
    const truncated = flights.length === MAX_ROWS;
    const coverage = `the last ${count(HISTORY_HOURS, 'hour')} and the next ${
        truncated ? count(flights.length, 'flight') : count(HORIZON_DAYS, 'day')
    }`;

    return <FlightStatusBoard flights={flights} coverage={coverage} />;
}
