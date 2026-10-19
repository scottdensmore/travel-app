"use client";

import React, { useEffect, useState, useTransition } from 'react';
import { getUserPointsLedgerHistoryAction } from '@/app/actions';
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
    totalCount?: number;
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
    totalCount,
    accountTimeZone,
    pageSize = 5,
}: PointsLedgerTableProps) {
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedType, setSelectedType] = useState<string>('ALL');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [totalEntriesCount, setTotalEntriesCount] = useState(totalCount ?? entries.length);
    const [serverPageEntries, setServerPageEntries] = useState<Record<number, PointsLedgerEntryRow[]>>({});
    const [filteredServerPageEntries, setFilteredServerPageEntries] = useState<Record<number, PointsLedgerEntryRow[]>>({});
    const [filteredTotalCount, setFilteredTotalCount] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        setTotalEntriesCount(totalCount ?? entries.length);
        setServerPageEntries({});
        setFilteredServerPageEntries({});
        setFilteredTotalCount(null);
        setCurrentPage(1);
    }, [entries, totalCount]);

    const normalizedSearch = searchQuery.trim().toLowerCase();

    const locallyFilteredEntries = selectedType === 'ALL'
        ? entries
        : entries.filter((entry) => entry.type === selectedType);

    const searchFilteredEntries = normalizedSearch === ''
        ? locallyFilteredEntries
        : locallyFilteredEntries.filter((entry) => {
            const typeLabel = TYPE_CONFIG[entry.type]?.label ?? entry.type;
            const bookingIdStr = entry.bookingId ? String(entry.bookingId) : '';
            return (
                entry.description.toLowerCase().includes(normalizedSearch) ||
                typeLabel.toLowerCase().includes(normalizedSearch) ||
                bookingIdStr.toLowerCase().includes(normalizedSearch)
            );
        });

    const activeTotalCount = normalizedSearch !== ''
        ? searchFilteredEntries.length
        : selectedType === 'ALL'
            ? totalEntriesCount
            : (filteredTotalCount ?? locallyFilteredEntries.length);

    const totalPages = Math.ceil(activeTotalCount / pageSize) || 1;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    const currentEntries = normalizedSearch !== ''
        ? searchFilteredEntries.slice(startIndex, endIndex)
        : selectedType === 'ALL'
            ? (serverPageEntries[currentPage] ?? entries.slice(startIndex, endIndex))
            : (filteredServerPageEntries[currentPage] ?? locallyFilteredEntries.slice(startIndex, endIndex));

    const handleTypeChange = (newType: string) => {
        setSelectedType(newType);
        setCurrentPage(1);
        setError(null);
        setFilteredServerPageEntries({});
        setFilteredTotalCount(null);

        if (newType !== 'ALL' && totalEntriesCount > entries.length) {
            startTransition(async () => {
                try {
                    const result = await getUserPointsLedgerHistoryAction({
                        page: 1,
                        pageSize,
                        type: newType,
                    } as Parameters<typeof getUserPointsLedgerHistoryAction>[0]);
                    if (result && Array.isArray(result.entries)) {
                        startTransition(() => {
                            setFilteredServerPageEntries({ 1: result.entries });
                            setFilteredTotalCount(
                                typeof result.totalCount === 'number' ? result.totalCount : result.entries.length
                            );
                        });
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Unable to load points activity page.';
                    startTransition(() => {
                        setError(msg);
                    });
                }
            });
        }
    };

    const navigateToPage = (targetPage: number) => {
        const clampedPage = Math.max(1, Math.min(totalPages, targetPage));
        if (clampedPage === currentPage || isPending) return;

        setError(null);

        if (normalizedSearch !== '') {
            setCurrentPage(clampedPage);
            return;
        }

        const targetStart = (clampedPage - 1) * pageSize;
        const targetEnd = targetStart + pageSize;

        if (selectedType !== 'ALL') {
            const availableFilteredLocally =
                Boolean(filteredServerPageEntries[clampedPage])
                || totalEntriesCount <= entries.length;

            if (availableFilteredLocally) {
                setCurrentPage(clampedPage);
                return;
            }

            startTransition(async () => {
                try {
                    const result = await getUserPointsLedgerHistoryAction({
                        page: clampedPage,
                        pageSize,
                        type: selectedType,
                    } as Parameters<typeof getUserPointsLedgerHistoryAction>[0]);
                    if (result && Array.isArray(result.entries)) {
                        startTransition(() => {
                            setFilteredServerPageEntries(prev => ({
                                ...prev,
                                [clampedPage]: result.entries,
                            }));
                            setFilteredTotalCount(
                                typeof result.totalCount === 'number' ? result.totalCount : result.entries.length
                            );
                            setCurrentPage(clampedPage);
                        });
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Unable to load points activity page.';
                    startTransition(() => {
                        setError(msg);
                    });
                }
            });
            return;
        }

        const availableLocally =
            Boolean(serverPageEntries[clampedPage])
            || (targetStart < entries.length && (targetEnd <= entries.length || targetEnd >= totalEntriesCount));

        if (availableLocally) {
            setCurrentPage(clampedPage);
            return;
        }

        startTransition(async () => {
            try {
                const result = await getUserPointsLedgerHistoryAction({
                    page: clampedPage,
                    pageSize,
                });
                startTransition(() => {
                    setServerPageEntries(prev => ({
                        ...prev,
                        [clampedPage]: result.entries,
                    }));
                    setTotalEntriesCount(result.totalCount);
                    setCurrentPage(clampedPage);
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Unable to load points activity page.';
                startTransition(() => {
                    setError(msg);
                });
            }
        });
    };

    return (
        <div className="points-ledger-section" data-testid="points-ledger-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <h3 className="text-xl font-bold" style={{ margin: 0 }}>Points Activity History</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <input
                        id="points-ledger-search"
                        type="search"
                        aria-label="Search points activity"
                        data-testid="points-ledger-search"
                        placeholder="Search description or booking..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentPage(1);
                        }}
                        style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.875rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #d1d5db',
                            backgroundColor: '#ffffff',
                            color: '#111827',
                        }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label htmlFor="points-ledger-type-filter" style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                            Filter by type:
                        </label>
                        <select
                            id="points-ledger-type-filter"
                            aria-label="Filter points activity by type"
                            data-testid="points-ledger-type-filter"
                            value={selectedType}
                            onChange={(e) => handleTypeChange(e.target.value)}
                            style={{
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.875rem',
                                borderRadius: '0.375rem',
                                border: '1px solid #d1d5db',
                                backgroundColor: '#ffffff',
                                color: '#111827',
                            }}
                        >
                            <option value="ALL">All Activity</option>
                            <option value="WELCOME_GRANT">Welcome Grant</option>
                            <option value="FLIGHT_EARN">Flight Earn</option>
                            <option value="REWARD_REDEMPTION">Redemption</option>
                            <option value="REWARD_REFUND">Refund</option>
                            <option value="ADMIN_ADJUSTMENT">Adjustment</option>
                        </select>
                    </div>
                    <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                        Times shown in {accountTimeZone}
                    </span>
                </div>
            </div>

            {error && (
                <div
                    role="alert"
                    data-testid="points-ledger-error"
                    style={{
                        marginBottom: '1rem',
                        padding: '0.75rem 1rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#fef2f2',
                        color: '#991b1b',
                        border: '1px solid #fecaca',
                        fontSize: '0.875rem',
                    }}
                >
                    {error}
                </div>
            )}

            {totalEntriesCount === 0 && entries.length === 0 ? (
                <p className="text-gray-500 italic" data-testid="points-ledger-empty" style={{ padding: '1rem 0' }}>
                    No reward points activity recorded yet.
                </p>
            ) : currentEntries.length === 0 ? (
                <p className="text-gray-500 italic" data-testid="points-ledger-filter-empty" style={{ padding: '1rem 0' }}>
                    No matching points activity found for the selected filter.
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
                                    onClick={() => navigateToPage(currentPage - 1)}
                                    disabled={currentPage === 1 || isPending}
                                    style={{
                                        padding: '0.375rem 0.75rem',
                                        fontSize: '0.875rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: currentPage === 1 || isPending ? '#f3f4f6' : '#ffffff',
                                        color: currentPage === 1 || isPending ? '#9ca3af' : '#111827',
                                        cursor: currentPage === 1 || isPending ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigateToPage(currentPage + 1)}
                                    disabled={currentPage === totalPages || isPending}
                                    style={{
                                        padding: '0.375rem 0.75rem',
                                        fontSize: '0.875rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: currentPage === totalPages || isPending ? '#f3f4f6' : '#ffffff',
                                        color: currentPage === totalPages || isPending ? '#9ca3af' : '#111827',
                                        cursor: currentPage === totalPages || isPending ? 'not-allowed' : 'pointer',
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

