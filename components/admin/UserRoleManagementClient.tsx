'use client';

import React, { useState, useEffect, useRef } from 'react';
import StepUpModal from './StepUpModal';
import { updateUserRoleAction, adjustUserPointsAction } from '@/app/actions/userRoleActions';
import { Role } from '@prisma/client';

export interface UserItem {
    id: string;
    name?: string | null;
    email: string | null;
    role: Role | string;
    spendablePoints?: number;
    createdAt?: string | Date | null;
}

export interface UserRoleManagementClientProps {
    initialUsers: UserItem[];
}

const ROLES: Role[] = ['USER', 'ADMIN', 'SUPPORT', 'OPERATIONS', 'MODERATOR'];

export default function UserRoleManagementClient({
    initialUsers,
}: UserRoleManagementClientProps) {
    const [users, setUsers] = useState<UserItem[]>(initialUsers);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [roleFilter, setRoleFilter] = useState<string>('ALL');
    const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

    // Pending role change state
    const [pendingChange, setPendingChange] = useState<{
        user: UserItem;
        newRole: Role;
    } | null>(null);
    const [reason, setReason] = useState<string>('');
    const [reasonError, setReasonError] = useState<string | null>(null);
    const reasonModalRef = useRef<HTMLDivElement | null>(null);
    const reasonInputRef = useRef<HTMLTextAreaElement | null>(null);

    // Pending points adjustment state
    const [pendingPointsUser, setPendingPointsUser] = useState<UserItem | null>(null);
    const [pointsAmountInput, setPointsAmountInput] = useState<string>('');
    const [pointsAmount, setPointsAmount] = useState<number>(0);
    const [pointsReason, setPointsReason] = useState<string>('');
    const [pointsError, setPointsError] = useState<string | null>(null);
    const pointsModalRef = useRef<HTMLDivElement | null>(null);
    const pointsAmountInputRef = useRef<HTMLInputElement | null>(null);

    // Step-up modal state
    const [isStepUpOpen, setIsStepUpOpen] = useState<boolean>(false);
    const [stepUpError, setStepUpError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    // Filter users based on search and role
    const filteredUsers = users.filter((u) => {
        const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
        if (!matchesRole) return false;
        const trimmedSearch = searchQuery.trim();
        if (trimmedSearch === '') return true;
        const q = trimmedSearch.toLowerCase();
        const matchesName = (u.name ?? '').toLowerCase().includes(q);
        const matchesEmail = (u.email ?? '').toLowerCase().includes(q);
        return matchesName || matchesEmail;
    });

    const handleRoleSelectChange = (user: UserItem, newRole: Role) => {
        if (user.role === newRole) return;
        setPendingPointsUser(null);
        setPendingChange({ user, newRole });
        setReason('');
        setReasonError(null);
        setFeedback(null);
    };

    const handleOpenPointsModal = (user: UserItem) => {
        setPendingChange(null);
        setPendingPointsUser(user);
        setPointsAmountInput('');
        setPointsAmount(0);
        setPointsReason('');
        setPointsError(null);
        setFeedback(null);
    };

    const handleCancelPending = () => {
        setIsStepUpOpen(false);
        setPendingChange(null);
        setReason('');
        setReasonError(null);
        setPendingPointsUser(null);
        setPointsAmountInput('');
        setPointsAmount(0);
        setPointsReason('');
        setPointsError(null);
        setStepUpError(null);
    };

    useEffect(() => {
        const activeModalRef = pendingChange ? reasonModalRef : pendingPointsUser ? pointsModalRef : null;
        if ((pendingChange || pendingPointsUser) && !isStepUpOpen) {
            setTimeout(() => {
                if (pendingChange) {
                    reasonInputRef.current?.focus();
                } else if (pendingPointsUser) {
                    pointsAmountInputRef.current?.focus();
                }
            }, 50);

            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelPending();
                    return;
                }

                if (e.key !== 'Tab' || !activeModalRef?.current) return;

                const focusableElements = Array.from(
                    activeModalRef.current.querySelectorAll<HTMLElement>(
                        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
                    )
                );
                if (focusableElements.length === 0) return;

                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === firstElement || !activeModalRef.current.contains(document.activeElement)) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    if (document.activeElement === lastElement || !activeModalRef.current.contains(document.activeElement)) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            };

            document.addEventListener('keydown', handleKeyDown);
            return () => {
                document.removeEventListener('keydown', handleKeyDown);
            };
        }
    }, [pendingChange, pendingPointsUser, isStepUpOpen]);

    const handleContinueToStepUp = (e: React.FormEvent) => {
        e.preventDefault();
        if (!reason.trim()) {
            setReasonError('A valid operational reason is required for role changes.');
            return;
        }
        setReasonError(null);
        setStepUpError(null);
        setIsStepUpOpen(true);
    };

    const handleContinuePointsToStepUp = (e: React.FormEvent) => {
        e.preventDefault();
        const parsed = Number(pointsAmountInput.trim());
        if (!pointsAmountInput.trim() || !Number.isInteger(parsed) || parsed === 0) {
            setPointsError('Enter a non-zero whole integer points adjustment (e.g. +5000 or -2000).');
            return;
        }
        if (Math.abs(parsed) > 1_000_000) {
            setPointsError('Points adjustment cannot exceed 1,000,000 points.');
            return;
        }
        if (!pointsReason.trim()) {
            setPointsError('A valid operational reason is required for points adjustments.');
            return;
        }
        setPointsAmount(parsed);
        setPointsError(null);
        setStepUpError(null);
        setIsStepUpOpen(true);
    };

    const handleStepUpSubmit = async (code: string) => {
        if (pendingChange) {
            setIsSubmitting(true);
            setStepUpError(null);

            try {
                const res = await updateUserRoleAction({
                    userId: pendingChange.user.id,
                    newRole: pendingChange.newRole,
                    reason: reason.trim(),
                    stepUpCode: code,
                });

                if (res.success) {
                    const updatedUserId = pendingChange.user.id;
                    const newRole = pendingChange.newRole;
                    const userEmail = pendingChange.user.email;

                    // Update local list
                    setUsers((prev) =>
                        prev.map((u) => (u.id === updatedUserId ? { ...u, role: newRole } : u))
                    );

                    setIsStepUpOpen(false);
                    setPendingChange(null);
                    setReason('');
                    setFeedback({
                        message: `Successfully updated role to ${newRole} for ${userEmail}.`,
                        isError: false,
                    });
                } else {
                    setStepUpError(res.error || 'Failed to update user role.');
                }
            } catch (err: unknown) {
                setStepUpError(err instanceof Error ? err.message : 'Failed to update user role.');
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        if (pendingPointsUser) {
            setIsSubmitting(true);
            setStepUpError(null);

            try {
                const res = await adjustUserPointsAction({
                    userId: pendingPointsUser.id,
                    amount: pointsAmount,
                    reason: pointsReason.trim(),
                    stepUpCode: code,
                });

                if (res.success) {
                    const updatedUserId = pendingPointsUser.id;
                    const userEmail = pendingPointsUser.email;
                    const newBalance =
                        typeof res.balanceAfter === 'number'
                            ? res.balanceAfter
                            : (pendingPointsUser.spendablePoints ?? 0) + pointsAmount;

                    setUsers((prev) =>
                        prev.map((u) => (u.id === updatedUserId ? { ...u, spendablePoints: newBalance } : u))
                    );

                    setIsStepUpOpen(false);
                    setPendingPointsUser(null);
                    setPointsAmountInput('');
                    setPointsAmount(0);
                    setPointsReason('');
                    setFeedback({
                        message: `Successfully adjusted points for ${userEmail}. New balance: ${newBalance.toLocaleString()} pts.`,
                        isError: false,
                    });
                } else {
                    setStepUpError(res.error || 'Failed to adjust user points.');
                }
            } catch (err: unknown) {
                setStepUpError(err instanceof Error ? err.message : 'Failed to adjust user points.');
            } finally {
                setIsSubmitting(false);
            }
        }
    };

    const getRoleBadgeStyle = (role: string) => {
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

    const parsedDelta = Number(pointsAmountInput.trim());
    const hasValidPreviewDelta =
        pointsAmountInput.trim() !== '' && Number.isInteger(parsedDelta) && parsedDelta !== 0;
    const currentPointsBalance = pendingPointsUser?.spendablePoints ?? 0;
    const projectedPointsBalance = currentPointsBalance + (hasValidPreviewDelta ? parsedDelta : 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#fff', margin: 0 }}>
                        User Role Management
                    </h1>
                    <p style={{ margin: '4px 0 0 0', color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>
                        Manage user roles and staff authorizations. Role promotions and demotions require a mandatory justification and Step-Up TOTP authentication.
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <input
                        id="user-management-search"
                        type="search"
                        aria-label="Search users by name or email"
                        data-testid="user-management-search"
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '280px',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            background: '#17142d',
                            color: '#fff',
                            fontSize: '0.9rem',
                            outline: 'none',
                        }}
                    />
                    <select
                        id="user-management-role-filter"
                        aria-label="Filter users by role"
                        data-testid="user-management-role-filter"
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            background: '#17142d',
                            color: '#fff',
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            outline: 'none',
                        }}
                    >
                        <option value="ALL">All Roles</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="OPS">OPS</option>
                        <option value="SUPPORT">SUPPORT</option>
                        <option value="USER">USER</option>
                    </select>
                </div>
            </div>

            {feedback && (
                <div
                    role="alert"
                    style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        backgroundColor: feedback.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                        border: feedback.isError ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(34, 197, 94, 0.4)',
                        color: feedback.isError ? '#f87171' : '#4ade80',
                        fontSize: '0.9rem',
                        fontWeight: 500,
                    }}
                >
                    {feedback.message}
                </div>
            )}

            {/* Users Table */}
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
                                    Name
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Email
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Current Role
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Points Balance
                                </th>
                                <th style={{ padding: '12px 16px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>
                                    Modify Role
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((user) => {
                                const style = getRoleBadgeStyle(user.role);
                                return (
                                    <tr
                                        key={user.id}
                                        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}
                                    >
                                        <td style={{ padding: '12px 16px', fontSize: '0.9rem', color: '#fff', fontWeight: 500 }}>
                                            {user.name || '—'}
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                                            {user.email}
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.8rem' }}>
                                            <span
                                                style={{
                                                    display: 'inline-block',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    backgroundColor: style.bg,
                                                    border: `1px solid ${style.border}`,
                                                    color: style.text,
                                                    fontWeight: 600,
                                                    fontSize: '0.75rem',
                                                }}
                                            >
                                                {user.role}
                                            </span>
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#fff' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontWeight: 600 }}>
                                                    {(user.spendablePoints ?? 0).toLocaleString()} pts
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenPointsModal(user)}
                                                    style={{
                                                        padding: '4px 10px',
                                                        borderRadius: '6px',
                                                        border: '1px solid rgba(192, 132, 252, 0.4)',
                                                        background: 'rgba(192, 132, 252, 0.15)',
                                                        color: '#c084fc',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Adjust Points
                                                </button>
                                            </div>
                                        </td>
                                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                            <select
                                                aria-label={`Change role for ${user.email}`}
                                                value={user.role}
                                                onChange={(e) => handleRoleSelectChange(user, e.target.value as Role)}
                                                style={{
                                                    padding: '6px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                                    background: '#17142d',
                                                    color: '#fff',
                                                    fontSize: '0.85rem',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {ROLES.map((r) => (
                                                    <option key={r} value={r}>
                                                        {r}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                    </tr>
                                );
                            })}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '36px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                        No users found.
                                    </td>
                                </tr>
                            )}
                            {users.length > 0 && filteredUsers.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '36px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                        No users match the current filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Reason Prompt Modal */}
            {pendingChange && !isStepUpOpen && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) handleCancelPending();
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
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
                        ref={reasonModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="role-reason-title"
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '480px',
                            width: '100%',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 id="role-reason-title" style={{ margin: 0, fontSize: '1.25rem', color: '#c084fc', fontWeight: 'bold' }}>
                                Reason for Role Change
                            </h3>
                            <button
                                type="button"
                                onClick={handleCancelPending}
                                aria-label="Close dialog"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'rgba(255, 255, 255, 0.7)',
                                    fontSize: '1.25rem',
                                    cursor: 'pointer',
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.4 }}>
                            Changing role for <strong style={{ color: '#fff' }}>{pendingChange.user.email}</strong> from{' '}
                            <span style={{ color: '#f87171', fontWeight: 600 }}>{pendingChange.user.role}</span> to{' '}
                            <span style={{ color: '#4ade80', fontWeight: 600 }}>{pendingChange.newRole}</span>.
                        </p>

                        {reasonError && (
                            <div
                                role="alert"
                                style={{
                                    padding: '8px 12px',
                                    marginBottom: '14px',
                                    borderRadius: '6px',
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.4)',
                                    color: '#f87171',
                                    fontSize: '0.85rem',
                                }}
                            >
                                {reasonError}
                            </div>
                        )}

                        <form onSubmit={handleContinueToStepUp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label
                                    htmlFor="role-change-reason"
                                    style={{ display: 'block', fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', marginBottom: '6px' }}
                                >
                                    Justification Reason
                                </label>
                                <textarea
                                    id="role-change-reason"
                                    ref={reasonInputRef}
                                    rows={3}
                                    placeholder="Explain the justification for this role assignment..."
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        background: '#17142d',
                                        color: '#fff',
                                        fontSize: '0.9rem',
                                        boxSizing: 'border-box',
                                        resize: 'vertical',
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button
                                    type="button"
                                    onClick={handleCancelPending}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        background: 'transparent',
                                        color: 'rgba(255, 255, 255, 0.8)',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!reason.trim()}
                                    style={{
                                        padding: '8px 18px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: '#c084fc',
                                        color: '#0f0a19',
                                        fontWeight: 'bold',
                                        cursor: !reason.trim() ? 'not-allowed' : 'pointer',
                                        fontSize: '0.9rem',
                                        opacity: !reason.trim() ? 0.6 : 1,
                                    }}
                                >
                                    Continue to Authorization
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Adjust Points Modal */}
            {pendingPointsUser && !isStepUpOpen && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) handleCancelPending();
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
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
                        ref={pointsModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="adjust-points-title"
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '480px',
                            width: '100%',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 id="adjust-points-title" style={{ margin: 0, fontSize: '1.25rem', color: '#c084fc', fontWeight: 'bold' }}>
                                Adjust Loyalty Points
                            </h3>
                            <button
                                type="button"
                                onClick={handleCancelPending}
                                aria-label="Close dialog"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'rgba(255, 255, 255, 0.7)',
                                    fontSize: '1.25rem',
                                    cursor: 'pointer',
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.4 }}>
                            Adjusting points balance for <strong style={{ color: '#fff' }}>{pendingPointsUser.email}</strong> (Current balance:{' '}
                            <strong style={{ color: '#c084fc' }}>{(pendingPointsUser.spendablePoints ?? 0).toLocaleString()} pts</strong>).
                        </p>

                        {pointsError && (
                            <div
                                role="alert"
                                style={{
                                    padding: '8px 12px',
                                    marginBottom: '14px',
                                    borderRadius: '6px',
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.4)',
                                    color: '#f87171',
                                    fontSize: '0.85rem',
                                }}
                            >
                                {pointsError}
                            </div>
                        )}

                        <form onSubmit={handleContinuePointsToStepUp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label
                                    htmlFor="points-adjustment-amount"
                                    style={{ display: 'block', fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', marginBottom: '6px' }}
                                >
                                    Points Delta (e.g. +5000 or -2000)
                                </label>
                                <input
                                    id="points-adjustment-amount"
                                    ref={pointsAmountInputRef}
                                    type="text"
                                    placeholder="e.g. +5000 or -2000"
                                    value={pointsAmountInput}
                                    onChange={(e) => setPointsAmountInput(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        background: '#17142d',
                                        color: '#fff',
                                        fontSize: '0.9rem',
                                        boxSizing: 'border-box',
                                    }}
                                />
                                {hasValidPreviewDelta && (
                                    <div
                                        data-testid="points-adjustment-projected-balance"
                                        style={{
                                            marginTop: '6px',
                                            fontSize: '0.8rem',
                                            fontWeight: 600,
                                            color: projectedPointsBalance < 0 ? '#f87171' : '#34d399',
                                        }}
                                    >
                                        Projected balance: {projectedPointsBalance.toLocaleString('en-US')} pts
                                        {projectedPointsBalance < 0 ? ' (Warning: resulting balance is negative)' : ''}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label
                                    htmlFor="points-adjustment-reason"
                                    style={{ display: 'block', fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', marginBottom: '6px' }}
                                >
                                    Adjustment Reason
                                </label>
                                <textarea
                                    id="points-adjustment-reason"
                                    rows={3}
                                    placeholder="Explain the operational reason for this points adjustment..."
                                    value={pointsReason}
                                    onChange={(e) => setPointsReason(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        background: '#17142d',
                                        color: '#fff',
                                        fontSize: '0.9rem',
                                        boxSizing: 'border-box',
                                        resize: 'vertical',
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button
                                    type="button"
                                    onClick={handleCancelPending}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        background: 'transparent',
                                        color: 'rgba(255, 255, 255, 0.8)',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    style={{
                                        padding: '8px 18px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: '#c084fc',
                                        color: '#0f0a19',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                    }}
                                >
                                    Continue to Authorization
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Step-Up Modal for Role Mutation */}
            {pendingChange && (
                <StepUpModal
                    isOpen={isStepUpOpen}
                    title="Authorize Role Change"
                    description={`Enter 6-digit TOTP code to confirm updating role for ${pendingChange.user.email} to ${pendingChange.newRole}.`}
                    onClose={handleCancelPending}
                    onSubmit={handleStepUpSubmit}
                    error={stepUpError}
                    isSubmitting={isSubmitting}
                />
            )}

            {/* Step-Up Modal for Points Adjustment */}
            {pendingPointsUser && (
                <StepUpModal
                    isOpen={isStepUpOpen}
                    title="Authorize Points Adjustment"
                    description={`Enter 6-digit TOTP code to confirm adjusting points (${pointsAmount > 0 ? `+${pointsAmount}` : pointsAmount}) for ${pendingPointsUser.email}.`}
                    onClose={handleCancelPending}
                    onSubmit={handleStepUpSubmit}
                    error={stepUpError}
                    isSubmitting={isSubmitting}
                />
            )}
        </div>
    );
}

