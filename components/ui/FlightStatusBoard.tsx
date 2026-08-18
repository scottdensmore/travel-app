"use client"
import { flightFareCents, formatPrice } from '@/lib/bookingPricing';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { durationLabel, flightArrival, flightDeparture } from '@/lib/flightTime';
import { flightPhaseAt, type FlightPhase } from '@/lib/flightPhase';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    /// Elapsed minutes, from which the arrival is derived. Null for a flight
    /// created outside a schedule, which then shows no arrival (#84).
    durationMinutes?: number | null;
    priceCents: number;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
}

interface FlightStatusBoardProps {
    flights: Flight[];
    /** One server-clock snapshot for every row and filter on this render. */
    renderedAt: number;
    /**
     * The window this board holds, as a noun phrase the page composes — e.g.
     * "the last 2 hours and the next 7 days". Relative rather than absolute so
     * it reads the same in every timezone; see the note in `app/flights/page`.
     *
     * Required: a board that cannot say what it covers gives a fruitless search
     * no explanation, which is the whole point of stating it.
     */
    coverage: string;
}

const HIDDEN_BUT_ANNOUNCED: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
};

export default function FlightStatusBoard({ flights, renderedAt, coverage }: FlightStatusBoardProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | FlightPhase>('ALL');

    const matchesQuery = (flight: Flight) => {
        const query = searchQuery.toLowerCase().trim();
        return (
            flight.flightNumber.toLowerCase().includes(query) ||
            flight.from.toLowerCase().includes(query) ||
            flight.to.toLowerCase().includes(query) ||
            flight.airline.toLowerCase().includes(query)
        );
    };

    const phasedFlights = useMemo(() => flights.map(flight => ({
        flight,
        phase: flightPhaseAt(flight, renderedAt),
    })), [flights, renderedAt]);

    const filteredFlights = useMemo(() => {
        return phasedFlights.filter(({ flight, phase }) => {
            const matchesStatus =
                statusFilter === 'ALL' ||
                phase === statusFilter;

            return matchesQuery(flight) && matchesStatus;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phasedFlights, searchQuery, statusFilter]);

    /**
     * The empty state has four causes and they need four answers. One string
     * for all of them told a user who had only touched the status dropdown to
     * "try searching for a different destination" and to go book a flight —
     * neither of which was anything they had done (#153).
     */
    const emptyStateMessage = () => {
        const query = searchQuery.trim();
        const status = statusFilter === 'ALL' ? null : getStatusLabel(statusFilter);
        const filterDescription = statusFilter === 'UPCOMING' ||
            statusFilter === 'DEPARTED' ||
            statusFilter === 'ARRIVED'
            ? `have the ${status} phase`
            : `are marked ${status}`;
        const range = ` It only covers departures in ${coverage}.`;

        if (query && status) {
            // Which input emptied the table is knowable: if the query matches
            // something once the filter is ignored, the filter is the cause and
            // the window is not, so offering the window would send the reader
            // after the wrong thing. If it matches nothing at all, the window
            // is worth raising — that reader is the most likely to be looking
            // for a flight outside it.
            return flights.some(matchesQuery)
                ? `No flights on this board match “${query}” and ${filterDescription}.`
                : `No flights on this board match “${query}”.${range}`;
        }
        if (query) {
            // The way out is the link rendered below rather than a second
            // sentence pointing somewhere else.
            return `No flights on this board match “${query}”.${range}`;
        }
        if (status) {
            return `No flights on this board ${filterDescription}.`;
        }
        // Nothing typed, nothing filtered: the window itself is empty, so
        // suggesting a different search term would be nonsense.
        return `No departures are scheduled in ${coverage}.`;
    };

    const getStatusStyle = (status: FlightPhase) => {
        switch (status) {
            case 'UPCOMING':
                return { backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' };
            case 'DEPARTED':
                return { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)' };
            case 'ARRIVED':
                return { backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.3)' };
            case 'DELAYED':
                return { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' };
            case 'CANCELLED':
                return { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' };
            default:
                return { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: '#e5e7eb', border: '1px solid rgba(255, 255, 255, 0.1)' };
        }
    };

    const getStatusLabel = (status: FlightPhase) => {
        switch (status) {
            case 'UPCOMING':
                return 'Upcoming';
            case 'DEPARTED':
                return 'Departed';
            case 'ARRIVED':
                return 'Arrived';
            case 'DELAYED':
                return 'Delayed';
            case 'CANCELLED':
                return 'Cancelled';
            default:
                return status;
        }
    };

    return (
        <div className="page-container" style={{ minHeight: 'calc(100vh - 100px)', padding: '2rem 1rem' }}>
            <div style={{ maxWidth: '1000px', width: '100%', margin: '0 auto', color: '#fff' }}>
                <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '0.5rem' }}>Flight Status</h1>
                    {/* No live feed backs either the heading or these derived
                        schedule phases. Delayed/cancelled remain airline-set
                        statuses; the coverage line states the board's bounds. */}
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '1.1rem' }}>Scheduled phase and airline-set status for Mona Airways flights.</p>
                    {/* 0.6 rather than 0.45: at 0.45 this measured 4.31:1,
                        under AA, on the one sentence that has to be read to
                        avoid reading "not listed" as "cancelled". */}
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
                        This board covers departures in {coverage}.
                    </p>
                </div>

                <div style={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: '1rem', 
                    background: 'rgba(255, 255, 255, 0.03)', 
                    padding: '1.25rem', 
                    borderRadius: '16px', 
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
                    marginBottom: '2rem',
                    alignItems: 'center'
                }}>
                    <div style={{ flex: '2 1 300px' }}>
                        <input
                            type="text"
                            placeholder="Search by flight number, airline, origin, or destination..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ 
                                width: '100%', 
                                padding: '0.75rem 1rem', 
                                border: '1px solid rgba(255, 255, 255, 0.1)', 
                                borderRadius: '8px',
                                fontSize: '1rem',
                                color: '#fff',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)'
                            }}
                        />
                    </div>
                    <div style={{ flex: '1 1 150px' }}>
                        <select
                            aria-label="Filter by flight phase or status"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | FlightPhase)}
                            style={{ 
                                width: '100%', 
                                padding: '0.75rem 1rem', 
                                border: '1px solid rgba(255, 255, 255, 0.1)', 
                                borderRadius: '8px',
                                fontSize: '1rem',
                                color: '#fff',
                                backgroundColor: '#181720'
                            }}
                        >
                            <option value="ALL">All Phases / Statuses</option>
                            <option value="UPCOMING">Upcoming</option>
                            <option value="DEPARTED">Departed</option>
                            <option value="ARRIVED">Arrived</option>
                            <option value="DELAYED">Delayed</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </div>
                </div>

                <div style={{ 
                    background: 'rgba(255, 255, 255, 0.03)', 
                    borderRadius: '16px', 
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
                    overflow: 'hidden'
                }}>
                    {/* Filtering swaps the table out without moving focus, so
                        without this a screen reader user gets silence and no
                        result count. It matters more now that being outside the
                        board's window is the commonest reason for zero rows. */}
                    <p role="status" style={HIDDEN_BUT_ANNOUNCED}>
                        {filteredFlights.length === 1
                            ? '1 flight shown'
                            : `${filteredFlights.length} flights shown`}
                    </p>
                    {filteredFlights.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>Flight</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>From</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>To</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>Departure / Arrival</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>Phase / Status</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa', textAlign: 'right' }}>Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredFlights.map(({ flight, phase }) => {
                                    // Once per row: each of these builds Intl
                                    // formatters, and the board renders many.
                                    const departure = flightDeparture(flight);
                                    const arrival = flight.durationMinutes
                                        ? flightArrival({ ...flight, durationMinutes: flight.durationMinutes })
                                        : null;
                                    return (
                                        <tr key={flight.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)', transition: 'background-color 0.2s' }} className="hover:bg-white/5 transition-colors">
                                            <td style={{ padding: '1.25rem 1.5rem' }}>
                                                <div style={{ fontWeight: 'bold', color: '#c084fc' }}>{flight.airline}</div>
                                                <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</div>
                                            </td>
                                            <td style={{ padding: '1.25rem 1.5rem', fontWeight: '500', color: '#fff' }}>{flight.from}</td>
                                            <td style={{ padding: '1.25rem 1.5rem', fontWeight: '500', color: '#fff' }}>{flight.to}</td>
                                            <td style={{ padding: '1.25rem 1.5rem', color: '#fff' }}>
                                                <div style={{ whiteSpace: 'nowrap' }}>{departure.readableDate}</div>
                                                <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                                                    {departure.time} {departure.zoneLabel}
                                                    {arrival ? (
                                                        <>
                                                            {/* Arrival on the destination's clock, and the day
                                                                marker a timetable prints. Neither can be had by
                                                                subtracting the two local times (#84).

                                                                Worded rather than an arrow: a screen reader
                                                                either drops U+2192 or says "right arrow", which
                                                                left a bare second time under a Departure
                                                                heading. And the day marker is spelled out --
                                                                "+1" sat directly against a "GMT+1" zone label,
                                                                where no reader could tell which was which. */}
                                                            <div style={{ color: 'rgba(255, 255, 255, 0.75)' }}>
                                                                Arrives {arrival.time} {arrival.zoneLabel}
                                                                {arrival.dayOffset === 1 ? ' (next day)' : ''}
                                                                {arrival.dayOffset > 1 ? ` (+${arrival.dayOffset} days)` : ''}
                                                                {arrival.dayOffset < 0 ? ' (previous day)' : ''}
                                                            </div>
                                                            <div>{durationLabel(flight.durationMinutes!)}</div>
                                                        </>
                                                    ) : null}
                                                </div>
                                            </td>
                                            <td style={{ padding: '1.25rem 1.5rem' }}>
                                                <span style={{ 
                                                    padding: '0.25rem 0.75rem', 
                                                    borderRadius: '9999px', 
                                                    fontSize: '0.875rem', 
                                                    fontWeight: '600',
                                                    display: 'inline-block',
                                                    ...getStatusStyle(phase)
                                                }}>
                                                    {getStatusLabel(phase)}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', fontWeight: 'bold', color: '#34d399' }}>
                                                {formatPrice(flightFareCents(flight))}
                                            </td>
                                        </tr>
                                    );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', fontWeight: 'normal' }}>
                                {/* Decorative: otherwise heading navigation
                                    announces "magnifying glass tilted left"
                                    before the words that matter. */}
                                <span aria-hidden="true">🔍 </span>No flights found
                            </h2>
                            <p>{emptyStateMessage()}</p>
                            {searchQuery.trim() && (
                                <p style={{ marginTop: '0.75rem' }}>
                                    <Link href="/" style={{ color: '#a78bfa', fontWeight: 'bold' }}>
                                        Search all flights
                                    </Link>
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
