'use client';

import React, { useState } from 'react';
import StepUpModal from './StepUpModal';
import { updateUserRoleAction } from '@/app/actions/userRoleActions';
import { Role } from '@prisma/client';

export interface UserItem {
    id: string;
    name?: string | null;
    email: string | null;
    role: Role | string;
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
    const [search, setSearch] = useState<string>('');
    const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

    // Pending role change state
    const [pendingChange, setPendingChange] = useState<{
        user: UserItem;
        newRole: Role;
    } | null>(null);
    const [reason, setReason] = useState<string>('');
    const [reasonError, setReasonError] = useState<string | null>(null);

    // Step-up modal state
    const [isStepUpOpen, setIsStepUpOpen] = useState<boolean>(false);
    const [stepUpError, setStepUpError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    // Filter users based on search
    const filteredUsers = users.filter((u) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        const matchesName = u.name?.toLowerCase().includes(q) ?? false;
        const matchesEmail = u.email?.toLowerCase().includes(q) ?? false;
        return matchesName || matchesEmail;
    });

    const handleRoleSelectChange = (user: UserItem, newRole: Role) => {
        if (user.role === newRole) return;
        setPendingChange({ user, newRole });
        setReason('');
        setReasonError(null);
        setFeedback(null);
    };

    const handleCancelPending = () => {
        setPendingChange(null);
        setReason('');
        setReasonError(null);
    };

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

    const handleStepUpSubmit = async (code: string) => {
        if (!pendingChange) return;
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

                <div>
                    <input
                        type="text"
                        placeholder="Search users by name or email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
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
                                    Registered
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
                                        <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
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
                            {filteredUsers.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '36px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                        No users found matching &quot;{search}&quot;.
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

            {/* Step-Up Modal for Role Mutation */}
            {pendingChange && (
                <StepUpModal
                    isOpen={isStepUpOpen}
                    title="Authorize Role Change"
                    description={`Enter 6-digit TOTP code to confirm updating role for ${pendingChange.user.email} to ${pendingChange.newRole}.`}
                    onClose={() => setIsStepUpOpen(false)}
                    onSubmit={handleStepUpSubmit}
                    error={stepUpError}
                    isSubmitting={isSubmitting}
                />
            )}
        </div>
    );
}
