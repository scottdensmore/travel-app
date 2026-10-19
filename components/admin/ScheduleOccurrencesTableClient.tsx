'use client';

import React, { useMemo, useState } from 'react';
import { formatPrice } from '@/lib/bookingPricing';
import {
    type ScheduleImpactOccurrence,
    type ScheduleOccurrenceEligibility,
} from '@/lib/flightScheduleImpact';
import { durationLabel, flightDeparture } from '@/lib/flightTime';

export type OccurrenceImpactCategory =
    | 'SAFE_FUTURE'
    | 'BOOKED_FUTURE'
    | 'PAST'
    | ScheduleOccurrenceEligibility;

export interface ScheduleOccurrencesTableRow extends Omit<ScheduleImpactOccurrence, 'eligibility'> {
    eligibility?: ScheduleOccurrenceEligibility;
    category?: OccurrenceImpactCategory;
}

export interface ScheduleOccurrencesTableClientProps {
    occurrences: ScheduleOccurrencesTableRow[];
}

export const IMPACT_LABELS: Record<string, string> = {
    SAFE_FUTURE: 'Safe future',
    HISTORICAL: 'Historical',
    PAST: 'Historical',
    BOOKING_HISTORY: 'Booking history',
    BOOKED_FUTURE: 'Booking history',
    ACTIVE_CHECKOUT: 'Active checkout',
    OPERATIONAL_OVERRIDE: 'Operational override',
};

export const IMPACT_DESCRIPTIONS: Record<string, string> = {
    SAFE_FUTURE: 'No booking history, active checkout, or operational override.',
    HISTORICAL: 'Departure is at or before this preview time.',
    PAST: 'Departure is at or before this preview time.',
    BOOKING_HISTORY: 'At least one booking has included this occurrence.',
    BOOKED_FUTURE: 'At least one booking has included this occurrence.',
    ACTIVE_CHECKOUT: 'A customer currently holds at least one seat.',
    OPERATIONAL_OVERRIDE: 'Staff has changed this occurrence from on time.',
};

const ELIGIBILITY_COLORS: Record<string, string> = {
    SAFE_FUTURE: '#4ade80',
    HISTORICAL: '#d1d5db',
    PAST: '#d1d5db',
    BOOKING_HISTORY: '#fbbf24',
    BOOKED_FUTURE: '#fbbf24',
    ACTIVE_CHECKOUT: '#fbbf24',
    OPERATIONAL_OVERRIDE: '#fbbf24',
};

function resolveCategoryKey(occurrence: ScheduleOccurrencesTableRow): string {
    return occurrence.category ?? occurrence.eligibility ?? 'SAFE_FUTURE';
}

function matchesCategoryFilter(occurrence: ScheduleOccurrencesTableRow, categoryFilter: string): boolean {
    if (categoryFilter === 'ALL') return true;
    const rawKey = resolveCategoryKey(occurrence);
    if (rawKey === categoryFilter) return true;
    if (categoryFilter === 'PAST' && rawKey === 'HISTORICAL') return true;
    if (categoryFilter === 'BOOKED_FUTURE') {
        return (
            rawKey === 'BOOKING_HISTORY'
            || rawKey === 'ACTIVE_CHECKOUT'
            || rawKey === 'OPERATIONAL_OVERRIDE'
        );
    }
    return false;
}

export default function ScheduleOccurrencesTableClient({
    occurrences,
}: ScheduleOccurrencesTableClientProps) {
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

    const filteredOccurrences = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        return occurrences.filter((occurrence) => {
            if (!matchesCategoryFilter(occurrence, categoryFilter)) {
                return false;
            }
            if (normalizedQuery) {
                const departure = flightDeparture(occurrence);
                const categoryKey = resolveCategoryKey(occurrence);
                const label = IMPACT_LABELS[categoryKey] ?? categoryKey;
                const detail = IMPACT_DESCRIPTIONS[categoryKey] ?? '';
                const statusText = occurrence.status.replaceAll('_', ' ');
                const isoDate =
                    occurrence.departureDate instanceof Date
                        ? occurrence.departureDate.toISOString()
                        : String(occurrence.departureDate);
                const bookingText =
                    occurrence.bookingIds.length > 0
                        ? occurrence.bookingIds.map((id) => `Booking #${id}`).join(', ')
                        : '';

                const searchableFields = [
                    departure.readableDate,
                    departure.time,
                    departure.zoneLabel,
                    isoDate,
                    occurrence.status,
                    statusText,
                    categoryKey,
                    occurrence.eligibility ?? '',
                    occurrence.category ?? '',
                    label,
                    detail,
                    occurrence.airline,
                    occurrence.flightNumber,
                    occurrence.from,
                    occurrence.to,
                    bookingText,
                ];
                return searchableFields.some((field) =>
                    field.toLowerCase().includes(normalizedQuery),
                );
            }
            return true;
        });
    }, [occurrences, searchQuery, categoryFilter]);

    return (
        <div>
            {occurrences.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        marginBottom: '1rem',
                        alignItems: 'center',
                    }}
                >
                    <input
                        id="schedule-occurrences-search"
                        type="search"
                        aria-label="Search linked occurrences"
                        data-testid="schedule-occurrences-search"
                        placeholder="Search date, status, or reason..."
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
                        id="schedule-occurrences-category-filter"
                        aria-label="Filter occurrences by impact category"
                        data-testid="schedule-occurrences-category-filter"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
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
                        <option value="ALL" style={{ backgroundColor: '#181720', color: '#fff' }}>
                            All Categories
                        </option>
                        <option value="SAFE_FUTURE" style={{ backgroundColor: '#181720', color: '#fff' }}>
                            Will update (SAFE_FUTURE)
                        </option>
                        <option value="BOOKED_FUTURE" style={{ backgroundColor: '#181720', color: '#fff' }}>
                            Protected — booked (BOOKED_FUTURE)
                        </option>
                        <option value="PAST" style={{ backgroundColor: '#181720', color: '#fff' }}>
                            Protected — past/departed (PAST)
                        </option>
                    </select>
                </div>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.1)' }}>
                            <th style={headingStyle}>Occurrence</th>
                            <th style={headingStyle}>Departure</th>
                            <th style={headingStyle}>Current values</th>
                            <th style={headingStyle}>Customer commitments</th>
                            <th style={headingStyle}>Preview classification</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOccurrences.map((occurrence) => {
                            const departure = flightDeparture(occurrence);
                            const categoryKey = resolveCategoryKey(occurrence);
                            const label = IMPACT_LABELS[categoryKey] ?? categoryKey;
                            const detail = IMPACT_DESCRIPTIONS[categoryKey] ?? '';
                            const color = ELIGIBILITY_COLORS[categoryKey] ?? '#e5e7eb';
                            return (
                                <tr key={occurrence.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                    <td style={cellStyle}>
                                        <strong style={{ color: '#fff' }}>
                                            {occurrence.airline} {occurrence.flightNumber}
                                        </strong>
                                        <div style={secondaryStyle}>
                                            {occurrence.from} → {occurrence.to}
                                        </div>
                                    </td>
                                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                                        <span style={{ color: '#fff' }}>{departure.readableDate}</span>
                                        <div style={secondaryStyle}>
                                            {departure.time} {departure.zoneLabel}
                                        </div>
                                    </td>
                                    <td style={cellStyle}>
                                        <span style={{ color: '#fff' }}>
                                            {occurrence.durationMinutes === null
                                                ? 'Duration unavailable'
                                                : durationLabel(occurrence.durationMinutes)}{' '}
                                            · {formatPrice(occurrence.priceCents)}
                                        </span>
                                        <div style={secondaryStyle}>
                                            Status: {occurrence.status.replaceAll('_', ' ')}
                                        </div>
                                        {(occurrence.awardSeatsFirst !== undefined
                                            || occurrence.awardSeatsBusiness !== undefined
                                            || occurrence.awardSeatsPremiumEconomy !== undefined
                                            || occurrence.awardSeatsEconomy !== undefined) && (
                                            <div style={secondaryStyle}>
                                                {`Award seats: ${occurrence.awardSeatsFirst ?? 0}F · ${occurrence.awardSeatsBusiness ?? 0}J · ${occurrence.awardSeatsPremiumEconomy ?? 0}W · ${occurrence.awardSeatsEconomy ?? 0}Y`}
                                            </div>
                                        )}
                                    </td>
                                    <td style={cellStyle}>
                                        {occurrence.bookingIds.length > 0
                                            ? occurrence.bookingIds.map((id) => `Booking #${id}`).join(', ')
                                            : 'No booking history'}
                                        {occurrence.hasActiveCheckout && (
                                            <div style={{ color: '#fbbf24', marginTop: '4px' }}>
                                                Active checkout
                                            </div>
                                        )}
                                    </td>
                                    <td style={cellStyle}>
                                        <strong style={{ color }}>{label}</strong>
                                        <div style={secondaryStyle}>{detail}</div>
                                    </td>
                                </tr>
                            );
                        })}
                        {occurrences.length === 0 && (
                            <tr>
                                <td
                                    colSpan={5}
                                    style={{
                                        padding: '24px',
                                        textAlign: 'center',
                                        color: 'rgba(255, 255, 255, 0.55)',
                                    }}
                                >
                                    No linked occurrences exist for this template.
                                </td>
                            </tr>
                        )}
                        {occurrences.length > 0 && filteredOccurrences.length === 0 && (
                            <tr>
                                <td
                                    colSpan={5}
                                    style={{
                                        padding: '24px',
                                        textAlign: 'center',
                                        color: 'rgba(255, 255, 255, 0.55)',
                                    }}
                                >
                                    No occurrences match the current filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const headingStyle = {
    padding: '8px 12px',
    color: '#a78bfa',
    fontSize: '0.8rem',
    textTransform: 'uppercase' as const,
};

const cellStyle = {
    padding: '12px',
    color: '#e5e7eb',
    fontSize: '0.88rem',
    verticalAlign: 'top' as const,
};

const secondaryStyle = {
    color: 'rgba(255, 255, 255, 0.58)',
    fontSize: '0.78rem',
    marginTop: '4px',
};
