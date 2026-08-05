"use client"
import { flightFareCents, formatPrice } from '@/lib/bookingPricing';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    priceCents: number;
    status: string;
}

interface FlightStatusBoardProps {
    flights: Flight[];
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

export default function FlightStatusBoard({ flights, coverage }: FlightStatusBoardProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');

    const matchesQuery = (flight: Flight) => {
        const query = searchQuery.toLowerCase().trim();
        return (
            flight.flightNumber.toLowerCase().includes(query) ||
            flight.from.toLowerCase().includes(query) ||
            flight.to.toLowerCase().includes(query) ||
            flight.airline.toLowerCase().includes(query)
        );
    };

    const filteredFlights = useMemo(() => {
        return flights.filter((flight) => {
            const matchesStatus =
                statusFilter === 'ALL' ||
                flight.status === statusFilter;

            return matchesQuery(flight) && matchesStatus;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flights, searchQuery, statusFilter]);

    /**
     * The empty state has four causes and they need four answers. One string
     * for all of them told a user who had only touched the status dropdown to
     * "try searching for a different destination" and to go book a flight —
     * neither of which was anything they had done (#153).
     */
    const emptyStateMessage = () => {
        const query = searchQuery.trim();
        const status = statusFilter === 'ALL' ? null : getStatusLabel(statusFilter);
        const range = ` It only covers departures in ${coverage}.`;

        if (query && status) {
            // Which input emptied the table is knowable: if the query matches
            // something once the filter is ignored, the filter is the cause and
            // the window is not, so offering the window would send the reader
            // after the wrong thing. If it matches nothing at all, the window
            // is worth raising — that reader is the most likely to be looking
            // for a flight outside it.
            return flights.some(matchesQuery)
                ? `No flights on this board match “${query}” and are marked ${status}.`
                : `No flights on this board match “${query}”.${range}`;
        }
        if (query) {
            // The way out is the link rendered below rather than a second
            // sentence pointing somewhere else.
            return `No flights on this board match “${query}”.${range}`;
        }
        if (status) {
            return `No flights on this board are marked ${status}.`;
        }
        // Nothing typed, nothing filtered: the window itself is empty, so
        // suggesting a different search term would be nonsense.
        return `No departures are scheduled in ${coverage}.`;
    };

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'ON_TIME':
                return { backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' };
            case 'DELAYED':
                return { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' };
            case 'CANCELLED':
                return { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' };
            default:
                return { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: '#e5e7eb', border: '1px solid rgba(255, 255, 255, 0.1)' };
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'ON_TIME':
                return 'On Time';
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
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '0.5rem' }}>Live Flight Status</h1>
                    {/* No arrivals are shown and no feed backs the word
                        "real-time"; the coverage line below refuted both a line
                        later, which was worse than saying less. Timezone-aware
                        status wording is #84. */}
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '1.1rem' }}>Departure and schedule status for Mona Airways flights.</p>
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
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
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
                            <option value="ALL">All Statuses</option>
                            <option value="ON_TIME">On Time</option>
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
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>Departure</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa' }}>Status</th>
                                        <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#a78bfa', textAlign: 'right' }}>Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredFlights.map((flight) => (
                                        <tr key={flight.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)', transition: 'background-color 0.2s' }} className="hover:bg-white/5 transition-colors">
                                            <td style={{ padding: '1.25rem 1.5rem' }}>
                                                <div style={{ fontWeight: 'bold', color: '#c084fc' }}>{flight.airline}</div>
                                                <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</div>
                                            </td>
                                            <td style={{ padding: '1.25rem 1.5rem', fontWeight: '500', color: '#fff' }}>{flight.from}</td>
                                            <td style={{ padding: '1.25rem 1.5rem', fontWeight: '500', color: '#fff' }}>{flight.to}</td>
                                            <td style={{ padding: '1.25rem 1.5rem', color: '#fff' }}>
                                                <div>{new Date(flight.departureDate).toLocaleDateString()}</div>
                                                <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                                                    {new Date(flight.departureDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </td>
                                            <td style={{ padding: '1.25rem 1.5rem' }}>
                                                <span style={{ 
                                                    padding: '0.25rem 0.75rem', 
                                                    borderRadius: '9999px', 
                                                    fontSize: '0.875rem', 
                                                    fontWeight: '600',
                                                    display: 'inline-block',
                                                    ...getStatusStyle(flight.status)
                                                }}>
                                                    {getStatusLabel(flight.status)}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', fontWeight: 'bold', color: '#34d399' }}>
                                                {formatPrice(flightFareCents(flight))}
                                            </td>
                                        </tr>
                                    ))}
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
