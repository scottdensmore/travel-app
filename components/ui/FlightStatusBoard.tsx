"use client"

import React, { useState, useMemo } from 'react';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    returnDate: Date | string | null;
    price: string;
    status: string;
}

export default function FlightStatusBoard({ flights }: { flights: Flight[] }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');

    const filteredFlights = useMemo(() => {
        return flights.filter((flight) => {
            const query = searchQuery.toLowerCase().trim();
            const matchesQuery = 
                flight.flightNumber.toLowerCase().includes(query) ||
                flight.from.toLowerCase().includes(query) ||
                flight.to.toLowerCase().includes(query) ||
                flight.airline.toLowerCase().includes(query);
            
            const matchesStatus = 
                statusFilter === 'ALL' || 
                flight.status === statusFilter;

            return matchesQuery && matchesStatus;
        });
    }, [flights, searchQuery, statusFilter]);

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
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '1.1rem' }}>Real-time departures, arrivals, and schedule status updates.</p>
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
                                                {flight.price}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
                            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🔍 No flights found</div>
                            <p>Try searching for a different destination, origin, airline, or adjust the status filter.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
