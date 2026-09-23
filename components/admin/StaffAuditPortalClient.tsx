'use client';

import React, { useState, useEffect, useRef } from 'react';
import StepUpModal from './StepUpModal';
import { searchStaffAuditLogsAction, purgeExpiredAuditLogsAction } from '@/app/actions/staffAuditActions';

export interface AuditLogItem {
    id: string;
    actorId?: string | null;
    actorEmail: string;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string;
    beforeState?: unknown;
    afterState?: unknown;
    reason?: string | null;
    metadata?: unknown;
    ipAddress?: string | null;
    createdAt: string | Date;
    actor?: { name?: string | null; image?: string | null } | null;
}

export interface StaffAuditPortalClientProps {
    initialLogs: AuditLogItem[];
    initialTotalCount: number;
}

const ACTION_OPTIONS = [
    { value: 'ALL', label: 'All Actions' },
    { value: 'USER_ROLE_UPDATE', label: 'User Role Update' },
    { value: 'SCHEDULE_TERMS_UPDATE', label: 'Schedule Terms Update' },
    { value: 'SCHEDULE_SET_ACTIVE', label: 'Schedule Set Active' },
    { value: 'SCHEDULE_DELETE', label: 'Schedule Delete' },
    { value: 'REVIEW_MODERATE', label: 'Review Moderate' },
    { value: 'AUDIT_RETENTION_PURGE', label: 'Audit Retention Purge' },
];

export default function StaffAuditPortalClient({
    initialLogs,
    initialTotalCount,
}: StaffAuditPortalClientProps) {
    const [logs, setLogs] = useState<AuditLogItem[]>(initialLogs);
    const [totalCount, setTotalCount] = useState<number>(initialTotalCount);
    const [isSearching, setIsSearching] = useState<boolean>(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Filters
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [actorEmail, setActorEmail] = useState<string>('');
    const [action, setAction] = useState<string>('ALL');
    const [targetType, setTargetType] = useState<string>('');
    const [targetId, setTargetId] = useState<string>('');

    // Selected log for diff modal
    const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
    const diffDialogRef = useRef<HTMLDivElement | null>(null);

    // Retention purge state
    const [retentionDays, setRetentionDays] = useState<number>(365);
    const [purgeReason, setPurgeReason] = useState<string>('');
    const [isDryRun, setIsDryRun] = useState<boolean>(true);
    const [isPurging, setIsPurging] = useState<boolean>(false);
    const [purgeFeedback, setPurgeFeedback] = useState<{ message: string; isError: boolean } | null>(null);

    // Step-up modal for live purge
    const [isStepUpOpen, setIsStepUpOpen] = useState<boolean>(false);
    const [stepUpError, setStepUpError] = useState<string | null>(null);

    // Diff modal Escape listener
    useEffect(() => {
        if (!selectedLog) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setSelectedLog(null);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selectedLog]);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setIsSearching(true);
        setSearchError(null);

        try {
            const query: Record<string, unknown> = { limit: 50 };
            if (dateFrom) query.dateFrom = dateFrom;
            if (dateTo) query.dateTo = dateTo;
            if (actorEmail.trim()) query.actorEmail = actorEmail.trim();
            if (action && action !== 'ALL') query.action = action;
            if (targetType.trim()) query.targetType = targetType.trim();
            if (targetId.trim()) query.targetId = targetId.trim();

            const res = await searchStaffAuditLogsAction(query);
            if (res.success && res.logs) {
                setLogs(res.logs as AuditLogItem[]);
                setTotalCount(res.totalCount ?? res.logs.length);
            } else {
                setSearchError(res.error || 'Failed to search audit logs.');
            }
        } catch (err: unknown) {
            setSearchError(err instanceof Error ? err.message : 'Error executing search.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleResetFilters = () => {
        setDateFrom('');
        setDateTo('');
        setActorEmail('');
        setAction('ALL');
        setTargetType('');
        setTargetId('');
        setLogs(initialLogs);
        setTotalCount(initialTotalCount);
        setSearchError(null);
    };

    const handleDryRunPurge = async () => {
        if (!purgeReason.trim()) {
            setPurgeFeedback({ message: 'A compliance reason is required for retention purge.', isError: true });
            return;
        }
        setIsPurging(true);
        setPurgeFeedback(null);

        try {
            const res = await purgeExpiredAuditLogsAction({
                retentionDays,
                reason: purgeReason.trim(),
                dryRun: true,
            });

            if (res.success && res.dryRun) {
                setPurgeFeedback({
                    message: `Dry Run Complete: ${res.eligibleCount} log(s) older than ${retentionDays} days are eligible for deletion.`,
                    isError: false,
                });
            } else {
                setPurgeFeedback({
                    message: res.error || 'Dry run purge failed.',
                    isError: true,
                });
            }
        } catch (err: unknown) {
            setPurgeFeedback({
                message: err instanceof Error ? err.message : 'Failed to execute dry run.',
                isError: true,
            });
        } finally {
            setIsPurging(false);
        }
    };

    const handleLivePurgeSubmit = async (code: string) => {
        setIsPurging(true);
        setStepUpError(null);

        try {
            const res = await purgeExpiredAuditLogsAction({
                retentionDays,
                reason: purgeReason.trim(),
                dryRun: false,
                stepUpCode: code,
            });

            if (res.success && !res.dryRun) {
                setIsStepUpOpen(false);
                setPurgeFeedback({
                    message: `Purge Complete: Permanently removed ${res.deletedCount} audit record(s).`,
                    isError: false,
                });
                // Refresh logs list
                await handleSearch();
            } else {
                setStepUpError(res.error || 'Invalid step-up code or unauthorized.');
            }
        } catch (err: unknown) {
            setStepUpError(err instanceof Error ? err.message : 'Failed to execute live purge.');
        } finally {
            setIsPurging(false);
        }
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'ADMIN':
                return { bg: 'rgba(192, 132, 252, 0.2)', border: 'rgba(192, 132, 252, 0.4)', text: '#c084fc' };
            case 'SUPPORT':
                return { bg: 'rgba(56, 189, 248, 0.2)', border: 'rgba(56, 189, 248, 0.4)', text: '#38bdf8' };
            case 'OPERATIONS':
                return { bg: 'rgba(52, 211, 153, 0.2)', border: 'rgba(52, 211, 153, 0.4)', text: '#34d399' };
            case 'MODERATOR':
                return { bg: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.4)', text: '#fbbf24' };
            default:
                return { bg: 'rgba(156, 163, 175, 0.2)', border: 'rgba(156, 163, 175, 0.4)', text: '#9ca3af' };
        }
    };

    const getActionBadgeColor = (act: string) => {
        if (act.includes('DELETE') || act.includes('PURGE')) {
            return { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.4)', text: '#f87171' };
        }
        if (act.includes('ROLE')) {
            return { bg: 'rgba(167, 139, 250, 0.2)', border: 'rgba(167, 139, 250, 0.4)', text: '#a78bfa' };
        }
        if (act.includes('MODERATE')) {
            return { bg: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.4)', text: '#fbbf24' };
        }
        return { bg: 'rgba(56, 189, 248, 0.2)', border: 'rgba(56, 189, 248, 0.4)', text: '#38bdf8' };
    };

    const formatTimestamp = (dateInput: string | Date) => {
        try {
            const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
            return d.toLocaleString();
        } catch {
            return String(dateInput);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#fff', margin: 0 }}>
                        Staff Audit History
                    </h1>
                    <p style={{ margin: '4px 0 0 0', color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>
                        Immutable audit log of staff operations, role mutations, schedule adjustments, and moderation actions.
                    </p>
                </div>
                <div style={{ color: '#a78bfa', fontSize: '0.9rem', fontWeight: 600 }}>
                    Total Events: <span style={{ color: '#fff' }}>{totalCount}</span>
                </div>
            </div>

            {/* Filter Section */}
            <div
                className="admin-card"
                style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '20px',
                }}
            >
                <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#c084fc', margin: '0 0 16px 0' }}>
                    Filter & Search Logs
                </h2>
                <form
                    onSubmit={handleSearch}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '16px',
                        alignItems: 'end',
                    }}
                >
                    <div>
                        <label
                            htmlFor="filter-date-from"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Date From
                        </label>
                        <input
                            id="filter-date-from"
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="filter-date-to"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Date To
                        </label>
                        <input
                            id="filter-date-to"
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="filter-actor-email"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Actor Email
                        </label>
                        <input
                            id="filter-actor-email"
                            type="text"
                            placeholder="staff@example.com"
                            value={actorEmail}
                            onChange={(e) => setActorEmail(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="filter-action"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Action
                        </label>
                        <select
                            id="filter-action"
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        >
                            {ACTION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label
                            htmlFor="filter-target-type"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Target Type
                        </label>
                        <input
                            id="filter-target-type"
                            type="text"
                            placeholder="e.g. FlightSchedule, User"
                            value={targetType}
                            onChange={(e) => setTargetType(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="filter-target-id"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Target ID
                        </label>
                        <input
                            id="filter-target-id"
                            type="text"
                            placeholder="Target ID..."
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            type="submit"
                            disabled={isSearching}
                            style={{
                                flex: 1,
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#c084fc',
                                color: '#0f0a19',
                                fontWeight: 'bold',
                                fontSize: '0.85rem',
                                cursor: isSearching ? 'not-allowed' : 'pointer',
                                opacity: isSearching ? 0.7 : 1,
                            }}
                        >
                            {isSearching ? 'Filtering...' : 'Apply Filters'}
                        </button>
                        <button
                            type="button"
                            onClick={handleResetFilters}
                            disabled={isSearching}
                            style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: 'transparent',
                                color: 'rgba(255, 255, 255, 0.7)',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                            }}
                        >
                            Reset
                        </button>
                    </div>
                </form>

                {searchError && (
                    <div
                        role="alert"
                        style={{
                            marginTop: '12px',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#f87171',
                            fontSize: '0.85rem',
                        }}
                    >
                        {searchError}
                    </div>
                )}
            </div>

            {/* Audit Table */}
            <div
                className="admin-card"
                style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    overflow: 'hidden',
                }}
            >
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)', background: 'rgba(255, 255, 255, 0.02)' }}>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Timestamp
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Actor
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Role
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Action
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Target
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Reason
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>
                                    Details
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => {
                                const roleStyle = getRoleBadgeColor(log.actorRole);
                                const actionStyle = getActionBadgeColor(log.action);
                                return (
                                    <tr
                                        key={log.id}
                                        style={{
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                            transition: 'background-color 0.15s ease',
                                        }}
                                    >
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)', whiteSpace: 'nowrap' }}>
                                            {formatTimestamp(log.createdAt)}
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#fff' }}>
                                            <div style={{ fontWeight: 600 }}>{log.actorEmail}</div>
                                            {log.actor?.name && (
                                                <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{log.actor.name}</div>
                                            )}
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.8rem' }}>
                                            <span
                                                style={{
                                                    display: 'inline-block',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    backgroundColor: roleStyle.bg,
                                                    border: `1px solid ${roleStyle.border}`,
                                                    color: roleStyle.text,
                                                    fontWeight: 600,
                                                    fontSize: '0.75rem',
                                                }}
                                            >
                                                {log.actorRole}
                                            </span>
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.8rem' }}>
                                            <span
                                                style={{
                                                    display: 'inline-block',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    backgroundColor: actionStyle.bg,
                                                    border: `1px solid ${actionStyle.border}`,
                                                    color: actionStyle.text,
                                                    fontWeight: 600,
                                                    fontSize: '0.75rem',
                                                }}
                                            >
                                                {log.action}
                                            </span>
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#fff' }}>
                                            <div style={{ fontWeight: 500 }}>{log.targetType}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{log.targetId}</div>
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {log.reason || '—'}
                                        </td>
                                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedLog(log)}
                                                style={{
                                                    padding: '4px 10px',
                                                    borderRadius: '4px',
                                                    border: '1px solid rgba(192, 132, 252, 0.4)',
                                                    background: 'rgba(192, 132, 252, 0.1)',
                                                    color: '#c084fc',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                View Diff
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ padding: '36px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                        No audit log records match the current filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Retention Purge Section */}
            <div
                className="admin-card"
                style={{
                    background: 'rgba(239, 68, 68, 0.05)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '12px',
                    padding: '24px',
                }}
            >
                <div style={{ marginBottom: '16px' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#f87171', margin: 0 }}>
                        Audit Retention & Compliance Purge
                    </h2>
                    <p style={{ margin: '6px 0 0 0', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem' }}>
                        Purge audit logs older than the compliance threshold. A dry-run preview is performed before executing live deletion. Live deletion requires Step-Up MFA authorization and records an audit log.
                    </p>
                </div>

                {purgeFeedback && (
                    <div
                        role="alert"
                        style={{
                            padding: '10px 14px',
                            marginBottom: '16px',
                            borderRadius: '6px',
                            backgroundColor: purgeFeedback.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                            border: purgeFeedback.isError ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(34, 197, 94, 0.4)',
                            color: purgeFeedback.isError ? '#f87171' : '#4ade80',
                            fontSize: '0.875rem',
                        }}
                    >
                        {purgeFeedback.message}
                    </div>
                )}

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '16px',
                        alignItems: 'end',
                    }}
                >
                    <div>
                        <label
                            htmlFor="purge-retention-days"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Retention Period (Days)
                        </label>
                        <input
                            id="purge-retention-days"
                            type="number"
                            min={1}
                            value={retentionDays}
                            onChange={(e) => setRetentionDays(Math.max(1, parseInt(e.target.value) || 365))}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                        <label
                            htmlFor="purge-reason"
                            style={{ display: 'block', fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px' }}
                        >
                            Compliance Purge Reason (Required)
                        </label>
                        <input
                            id="purge-reason"
                            type="text"
                            placeholder="e.g. Annual SOC2 retention policy compliance purge"
                            value={purgeReason}
                            onChange={(e) => setPurgeReason(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '8px' }}>
                        <input
                            id="purge-dry-run"
                            type="checkbox"
                            checked={isDryRun}
                            onChange={(e) => setIsDryRun(e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: '#c084fc', cursor: 'pointer' }}
                        />
                        <label
                            htmlFor="purge-dry-run"
                            style={{ fontSize: '0.85rem', color: '#fff', cursor: 'pointer' }}
                        >
                            Dry Run (preview only)
                        </label>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={handleDryRunPurge}
                            disabled={isPurging}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: 'rgba(255, 255, 255, 0.08)',
                                color: '#fff',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                cursor: isPurging ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {isPurging && isDryRun ? 'Previewing...' : 'Preview Purge (Dry Run)'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (!purgeReason.trim()) {
                                    setPurgeFeedback({ message: 'A compliance reason is required for live retention purge.', isError: true });
                                    return;
                                }
                                setStepUpError(null);
                                setIsStepUpOpen(true);
                            }}
                            disabled={isPurging || !purgeReason.trim()}
                            style={{
                                padding: '8px 18px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#ef4444',
                                color: '#fff',
                                fontSize: '0.85rem',
                                fontWeight: 'bold',
                                cursor: isPurging || !purgeReason.trim() ? 'not-allowed' : 'pointer',
                                opacity: isPurging || !purgeReason.trim() ? 0.6 : 1,
                            }}
                        >
                            Purge Expired Logs
                        </button>
                    </div>
                </div>
            </div>

            {/* Diff Inspection Modal */}
            {selectedLog && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setSelectedLog(null);
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        backdropFilter: 'blur(8px)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                        boxSizing: 'border-box',
                    }}
                >
                    <div
                        ref={diffDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="diff-dialog-title"
                        tabIndex={-1}
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #17142d 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '850px',
                            width: '100%',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <div>
                                <h3 id="diff-dialog-title" style={{ margin: 0, fontSize: '1.25rem', color: '#c084fc', fontWeight: 'bold' }}>
                                    Audit State Diff: {selectedLog.action}
                                </h3>
                                <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                                    Target: <span style={{ color: '#fff' }}>{selectedLog.targetType}</span> ({selectedLog.targetId}) · Actor: <span style={{ color: '#fff' }}>{selectedLog.actorEmail}</span>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedLog(null)}
                                aria-label="Close dialog"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'rgba(255, 255, 255, 0.7)',
                                    fontSize: '1.25rem',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        {selectedLog.reason && (
                            <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', fontSize: '0.875rem' }}>
                                <strong style={{ color: '#a78bfa' }}>Reason:</strong> {selectedLog.reason}
                            </div>
                        )}

                        {/* Side by side state diff */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, overflowY: 'auto' }}>
                            <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#f87171', fontWeight: 600 }}>
                                    Before State
                                </h4>
                                <pre
                                    style={{
                                        margin: 0,
                                        fontSize: '0.8rem',
                                        color: '#fca5a5',
                                        overflowX: 'auto',
                                        fontFamily: 'monospace',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                    }}
                                >
                                    {selectedLog.beforeState !== undefined && selectedLog.beforeState !== null
                                        ? JSON.stringify(selectedLog.beforeState, null, 2)
                                        : 'None (Created)'}
                                </pre>
                            </div>

                            <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#4ade80', fontWeight: 600 }}>
                                    After State
                                </h4>
                                <pre
                                    style={{
                                        margin: 0,
                                        fontSize: '0.8rem',
                                        color: '#86efac',
                                        overflowX: 'auto',
                                        fontFamily: 'monospace',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                    }}
                                >
                                    {selectedLog.afterState !== undefined && selectedLog.afterState !== null
                                        ? JSON.stringify(selectedLog.afterState, null, 2)
                                        : 'None (Deleted)'}
                                </pre>
                            </div>
                        </div>

                        {selectedLog.metadata !== undefined && selectedLog.metadata !== null && (
                            <div style={{ marginTop: '16px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px', padding: '10px 12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.8rem', color: '#a78bfa' }}>
                                    Metadata
                                </h4>
                                <pre style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', fontFamily: 'monospace' }}>
                                    {JSON.stringify(selectedLog.metadata, null, 2)}
                                </pre>
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                            <button
                                type="button"
                                onClick={() => setSelectedLog(null)}
                                style={{
                                    padding: '8px 18px',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                    background: 'transparent',
                                    color: '#fff',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step-Up Modal for Purge */}
            <StepUpModal
                isOpen={isStepUpOpen}
                title="Authorize Audit Purge"
                description={`Enter 6-digit TOTP security code to confirm irreversible deletion of audit logs older than ${retentionDays} days.`}
                onClose={() => setIsStepUpOpen(false)}
                onSubmit={handleLivePurgeSubmit}
                error={stepUpError}
                isSubmitting={isPurging}
            />
        </div>
    );
}
