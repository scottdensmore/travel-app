"use client";

import React, { useState } from 'react';
import { formatAccountDateTime } from '@/lib/accountTimeZone';

export interface PointsLedgerEntryRow {
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    bookingId?: number | null;
    description: string;
    createdAt: Date | string;
}

interface PointsLedgerTableProps {
    entries: PointsLedgerEntryRow[];
    accountTimeZone: string;
    pageSize?: number;
}

const TYPE_CONFIG: Record<string, { label: string; badgeClass: string; style: React.CSSProperties }> = {
    WELCOME_GRANT: {
        label: 'Welcome Grant',
        badgeClass: 'badge-welcome',
        style: { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' },
    },
    FLIGHT_EARN: {
        label: 'Flight Earn',
        badgeClass: 'badge-earn',
        style: { backgroundColor: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' },
    },
    REWARD_REDEMPTION: {
        label: 'Redemption',
        badgeClass: 'badge-redemption',
        style: { backgroundColor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' },
    },
    REWARD_REFUND: {
        label: 'Refund',
        badgeClass: 'badge-refund',
        style: { backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' },
    },
    ADMIN_ADJUSTMENT: {
        label: 'Adjustment',
        badgeClass: 'badge-adjustment',
        style: { backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0' },
    },
};

export default function PointsLedgerTable({
    entries,
    accountTimeZone,
    pageSize = 5,
}: PointsLedgerTableProps) {
    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = Math.ceil(entries.length / pageSize) || 1;

    const startIndex = (currentPage - 1) * pageSize;
    const currentEntries = entries.slice(startIndex, startIndex + pageSize);

    return (
        <div className="points-ledger-section" data-testid="points-ledger-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="text-xl font-bold" style={{ margin: 0 }}>Points Activity History</h3>
                <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Times shown in {accountTimeZone}
                </span>
            </div>

            {entries.length === 0 ? (
                <p className="text-gray-500 italic" data-testid="points-ledger-empty" style={{ padding: '1rem 0' }}>
                    No reward points activity recorded yet.
                </p>
            ) : (
                <>
                    <div
                        className="table-responsive"
                        role="region"
                        aria-label="Points Activity History"
                        tabIndex={0}
                        style={{ overflowX: 'auto' }}
                    >
                        <table
                            className="points-activity-table"
                            data-testid="points-ledger-table"
                            style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}
                        >
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                                    <th scope="col" style={{ padding: '0.75rem 0.5rem' }}>Date</th>
                                    <th scope="col" style={{ padding: '0.75rem 0.5rem' }}>Type</th>
                                    <th scope="col" style={{ padding: '0.75rem 0.5rem' }}>Description</th>
                                    <th scope="col" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Points</th>
                                    <th scope="col" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentEntries.map((entry) => {
                                    const typeInfo = TYPE_CONFIG[entry.type] ?? {
                                        label: entry.type,
                                        badgeClass: 'badge-default',
                                        style: { backgroundColor: '#f3f4f6', color: '#374151' },
                                    };
                                    const isPositive = entry.amount > 0;
                                    const isNegative = entry.amount < 0;
                                    const amountFormatted = isPositive
                                        ? `+${entry.amount.toLocaleString()}`
                                        : entry.amount.toLocaleString();

                                    return (
                                        <tr
                                            key={entry.id}
                                            data-testid={`ledger-row-${entry.id}`}
                                            style={{ borderBottom: '1px solid #f3f4f6' }}
                                        >
                                            <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                                                {formatAccountDateTime(entry.createdAt, accountTimeZone)}
                                            </td>
                                            <td style={{ padding: '0.75rem 0.5rem', whiteSpace: 'nowrap' }}>
                                                <span
                                                    data-testid={`badge-${entry.type}`}
                                                    style={{
                                                        display: 'inline-block',
                                                        padding: '0.2rem 0.5rem',
                                                        borderRadius: '9999px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 600,
                                                        ...typeInfo.style,
                                                    }}
                                                >
                                                    {typeInfo.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.875rem' }}>
                                                {entry.description}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '0.75rem 0.5rem',
                                                    textAlign: 'right',
                                                    fontWeight: 600,
                                                    fontSize: '0.875rem',
                                                    color: isPositive ? '#16a34a' : isNegative ? '#dc2626' : '#4b5563',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {amountFormatted}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '0.75rem 0.5rem',
                                                    textAlign: 'right',
                                                    fontWeight: 600,
                                                    fontSize: '0.875rem',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {entry.balanceAfter.toLocaleString()} pts
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <nav
                            aria-label="Points Activity Pagination"
                            data-testid="points-ledger-pagination"
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginTop: '1rem',
                                paddingTop: '0.5rem',
                            }}
                        >
                            <span style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                                Page {currentPage} of {totalPages}
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    type="button"
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{
                                        padding: '0.375rem 0.75rem',
                                        fontSize: '0.875rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff',
                                        color: currentPage === 1 ? '#9ca3af' : '#111827',
                                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{
                                        padding: '0.375rem 0.75rem',
                                        fontSize: '0.875rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff',
                                        color: currentPage === totalPages ? '#9ca3af' : '#111827',
                                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    Next
                                </button>
                            </div>
                        </nav>
                    )}
                </>
            )}
        </div>
    );
}
