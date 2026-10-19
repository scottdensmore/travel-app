'use client';

import React, { useMemo, useState } from 'react';
import { outboundFlight } from '@/lib/bookingItinerary';

export interface AdminRecentBookingFlight {
    airline: string;
    flightNumber: string;
    from?: string;
    to?: string;
    fromAirport?: { label: string } | null;
    toAirport?: { label: string } | null;
}

export interface AdminRecentBookingLeg {
    sequence: number;
    supersededAt?: Date | string | null;
    flight: AdminRecentBookingFlight | null;
}

export interface AdminRecentBookingItem {
    id: number;
    createdAt: Date | string;
    isRewardBooking?: boolean | null;
    user?: {
        name?: string | null;
        email?: string | null;
    } | null;
    legs: AdminRecentBookingLeg[];
}

export interface AdminRecentBookingsClientProps {
    bookings: AdminRecentBookingItem[];
}

function resolveOutboundFlight(booking: AdminRecentBookingItem): {
    airline: string;
    flightNumber: string;
    from: string;
    to: string;
} | null {
    const normalizedLegs = (booking.legs ?? []).map((leg) => {
        if (!leg.flight) {
            return { ...leg, flight: null };
        }
        const from = leg.flight.from ?? leg.flight.fromAirport?.label ?? '';
        const to = leg.flight.to ?? leg.flight.toAirport?.label ?? '';
        return {
            ...leg,
            flight: {
                airline: leg.flight.airline,
                flightNumber: leg.flight.flightNumber,
                from,
                to,
            },
        };
    });
    return outboundFlight({ legs: normalizedLegs });
}

export default function AdminRecentBookingsClient({ bookings }: AdminRecentBookingsClientProps) {
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [bookingTypeFilter, setBookingTypeFilter] = useState<string>('ALL');

    const filteredBookings = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        return bookings.filter((booking) => {
            if (bookingTypeFilter === 'REWARD' && !Boolean(booking.isRewardBooking)) {
                return false;
            }
            if (bookingTypeFilter === 'CASH' && Boolean(booking.isRewardBooking)) {
                return false;
            }
            if (normalizedQuery) {
                const flight = resolveOutboundFlight(booking);
                const matchesName = (booking.user?.name ?? '').toLowerCase().includes(normalizedQuery);
                const matchesEmail = (booking.user?.email ?? '').toLowerCase().includes(normalizedQuery);
                const matchesFlightNumber = (flight?.flightNumber ?? '').toLowerCase().includes(normalizedQuery);
                const matchesAirline = (flight?.airline ?? '').toLowerCase().includes(normalizedQuery);
                const matchesFrom = (flight?.from ?? '').toLowerCase().includes(normalizedQuery);
                const matchesTo = (flight?.to ?? '').toLowerCase().includes(normalizedQuery);
                return (
                    matchesName ||
                    matchesEmail ||
                    matchesFlightNumber ||
                    matchesAirline ||
                    matchesFrom ||
                    matchesTo
                );
            }
            return true;
        });
    }, [bookings, searchQuery, bookingTypeFilter]);

    return (
        <div>
            {bookings.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                    <input
                        id="admin-recent-bookings-search"
                        type="search"
                        aria-label="Search recent bookings"
                        data-testid="admin-recent-bookings-search"
                        placeholder="Search customer, flight #, or route..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            flex: '1 1 240px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '0.85rem',
                            outline: 'none',
                        }}
                    />
                    <select
                        id="admin-recent-bookings-type-filter"
                        aria-label="Filter recent bookings by type"
                        data-testid="admin-recent-bookings-type-filter"
                        value={bookingTypeFilter}
                        onChange={(e) => setBookingTypeFilter(e.target.value)}
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            outline: 'none',
                        }}
                    >
                        <option value="ALL" style={{ backgroundColor: '#181720', color: '#fff' }}>All Bookings</option>
                        <option value="REWARD" style={{ backgroundColor: '#181720', color: '#fff' }}>Reward Only</option>
                        <option value="CASH" style={{ backgroundColor: '#181720', color: '#fff' }}>Cash Only</option>
                    </select>
                </div>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>User</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Flight</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Route</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredBookings.map((booking) => {
                            const flight = resolveOutboundFlight(booking);
                            return (
                                <tr key={booking.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                        {booking.user?.name || booking.user?.email || 'Guest'}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                        <span>{flight ? `${flight.airline} ${flight.flightNumber}` : '—'}</span>
                                        {booking.isRewardBooking && (
                                            <span style={{
                                                marginLeft: '8px',
                                                padding: '2px 6px',
                                                borderRadius: '9999px',
                                                fontSize: '0.7rem',
                                                fontWeight: 700,
                                                backgroundColor: 'rgba(167, 139, 250, 0.18)',
                                                color: '#c4b5fd',
                                                border: '1px solid rgba(167, 139, 250, 0.35)',
                                            }}>
                                                Reward
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                        {flight ? `${flight.from} → ${flight.to}` : '—'}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                                        {new Date(booking.createdAt).toLocaleDateString()}
                                    </td>
                                </tr>
                            );
                        })}
                        {bookings.length === 0 && (
                            <tr>
                                <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                    No bookings yet.
                                </td>
                            </tr>
                        )}
                        {bookings.length > 0 && filteredBookings.length === 0 && (
                            <tr>
                                <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                    No recent bookings match the current filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
