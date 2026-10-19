'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatPrice } from '@/lib/bookingPricing';
import { durationLabel } from '@/lib/flightTime';

export interface AdminScheduleItem {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureTime: string;
    durationMinutes: number;
    daysOfWeek: number[];
    priceCents?: number | null;
    isActive?: boolean;
    awardSeatsFirst?: number | null;
    awardSeatsBusiness?: number | null;
    awardSeatsPremiumEconomy?: number | null;
    awardSeatsEconomy?: number | null;
}

export interface AdminSchedulesTableClientProps {
    schedules: AdminScheduleItem[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getDaysLabel(days: number[]): string {
    return days.map((d) => DAY_LABELS[d]).join(', ');
}

export default function AdminSchedulesTableClient({ schedules }: AdminSchedulesTableClientProps) {
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');

    const filteredSchedules = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        return schedules.filter((schedule) => {
            if (statusFilter === 'ACTIVE' && schedule.isActive === false) {
                return false;
            }
            if (statusFilter === 'PAUSED' && schedule.isActive !== false) {
                return false;
            }
            if (normalizedQuery) {
                const matchesFlightNumber = schedule.flightNumber.toLowerCase().includes(normalizedQuery);
                const matchesAirline = schedule.airline.toLowerCase().includes(normalizedQuery);
                const matchesFrom = schedule.from.toLowerCase().includes(normalizedQuery);
                const matchesTo = schedule.to.toLowerCase().includes(normalizedQuery);
                return matchesFlightNumber || matchesAirline || matchesFrom || matchesTo;
            }
            return true;
        });
    }, [schedules, searchQuery, statusFilter]);

    return (
        <div>
            {schedules.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                    <input
                        id="admin-schedules-search"
                        type="search"
                        aria-label="Search flight templates"
                        data-testid="admin-schedules-search"
                        placeholder="Search flight #, airline, or route..."
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
                        id="admin-schedules-status-filter"
                        aria-label="Filter flight templates by status"
                        data-testid="admin-schedules-status-filter"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
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
                        <option value="ALL" style={{ backgroundColor: '#181720', color: '#fff' }}>All Templates</option>
                        <option value="ACTIVE" style={{ backgroundColor: '#181720', color: '#fff' }}>Active Only</option>
                        <option value="PAUSED" style={{ backgroundColor: '#181720', color: '#fff' }}>Paused Only</option>
                    </select>
                </div>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Flight</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Route</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Weekly Schedule</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Duration</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Price</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Status</th>
                            <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSchedules.map((schedule) => {
                            const isActive = schedule.isActive !== false;
                            return (
                                <tr key={schedule.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                    <td style={{ padding: '12px', fontSize: '0.9rem' }}>
                                        <div style={{ fontWeight: 'bold', color: '#fff' }}>{schedule.airline}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>{schedule.flightNumber}</div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                        {schedule.from} → {schedule.to}
                                        <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>Departs: {schedule.departureTime}</div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.85rem', color: '#e5e7eb' }}>
                                        {getDaysLabel(schedule.daysOfWeek)}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#e5e7eb', whiteSpace: 'nowrap' }}>
                                        {durationLabel(schedule.durationMinutes)}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#34d399', fontWeight: 'bold' }}>
                                        <div>{formatPrice(schedule.priceCents ?? 0)}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.55)', fontWeight: 'normal', marginTop: '2px' }}>
                                            {`Award: ${schedule.awardSeatsFirst ?? 1}F / ${schedule.awardSeatsBusiness ?? 2}J / ${schedule.awardSeatsPremiumEconomy ?? 2}W / ${schedule.awardSeatsEconomy ?? 4}Y`}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.85rem', color: isActive ? '#86efac' : '#fbbf24', fontWeight: 700 }}>
                                        {isActive ? 'Active' : 'Inactive'}
                                    </td>
                                    <td style={{ padding: '12px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                            <Link
                                                href={`/admin/flights/schedules/${schedule.id}`}
                                                style={{ color: '#7dd3fc', fontWeight: 700, whiteSpace: 'nowrap' }}
                                            >
                                                Preview impact
                                            </Link>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {schedules.length === 0 && (
                            <tr>
                                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                    No flight templates declared yet. Use the form on the left to add one!
                                </td>
                            </tr>
                        )}
                        {schedules.length > 0 && filteredSchedules.length === 0 && (
                            <tr>
                                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                    No flight templates match the current filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
