'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import type { NotificationCategory, NotificationChannel } from '@prisma/client';
import type { EffectivePreferences } from '@/lib/notificationService';
import { updateNotificationPreferencesAction } from '@/app/actions/notificationActions';

interface NotificationPreferencesClientProps {
    userEmail: string;
    initialPreferences: EffectivePreferences;
}

interface CategoryConfig {
    key: NotificationCategory;
    title: string;
    description: string;
    icon: string;
}

interface ChannelConfig {
    key: NotificationChannel;
    label: string;
    description: (email: string) => string;
}

const CATEGORIES: CategoryConfig[] = [
    {
        key: 'FLIGHT_STATUS',
        title: 'Flight Status & Operational Alerts',
        description: 'Real-time updates on gate changes, departure delays, cancellations, and boarding announcements.',
        icon: '✈️',
    },
    {
        key: 'ACCOUNT_ACTIVITY',
        title: 'Account & Bookings',
        description: 'Booking confirmations, itinerary receipts, cancellations, refunds, and loyalty points activity.',
        icon: '🎫',
    },
    {
        key: 'TRAVEL_GUIDES',
        title: 'Travel Guides & Tips',
        description: 'Curated destination recommendations, seasonal travel inspiration, and local tips.',
        icon: '🌍',
    },
];

const CHANNELS: ChannelConfig[] = [
    {
        key: 'IN_APP',
        label: 'In-App',
        description: () => 'Delivered to your notification drawer in the top navigation.',
    },
    {
        key: 'EMAIL',
        label: 'Email',
        description: (email: string) => (email ? `Sent to ${email}` : 'Sent to your account email address.'),
    },
];

export default function NotificationPreferencesClient({
    userEmail,
    initialPreferences,
}: NotificationPreferencesClientProps) {
    const [preferences, setPreferences] = useState<EffectivePreferences>(initialPreferences);
    const [isPending, startTransition] = useTransition();
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleToggle = (category: NotificationCategory, channel: NotificationChannel) => {
        const currentVal = preferences[category]?.[channel] ?? false;
        const nextVal = !currentVal;

        // Optimistic update
        setPreferences(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [channel]: nextVal,
            },
        }));
        setStatusMessage('Saving notification preferences...');
        setErrorMessage(null);

        startTransition(async () => {
            try {
                const res = await updateNotificationPreferencesAction([
                    {
                        category,
                        channel,
                        enabled: nextVal,
                    },
                ]);

                if (!res.ok) {
                    // Revert optimistic update
                    setPreferences(prev => ({
                        ...prev,
                        [category]: {
                            ...prev[category],
                            [channel]: currentVal,
                        },
                    }));
                    setStatusMessage(null);
                    const msg = 'error' in res && res.error?.message
                        ? res.error.message
                        : 'Failed to update notification preferences.';
                    setErrorMessage(msg);
                    return;
                }

                setStatusMessage('Notification preferences saved.');
            } catch (err: unknown) {
                // Revert optimistic update
                setPreferences(prev => ({
                    ...prev,
                    [category]: {
                        ...prev[category],
                        [channel]: currentVal,
                    },
                }));
                setStatusMessage(null);
                const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
                setErrorMessage(msg);
            }
        });
    };

    return (
        <div className="page-container privacy-page notification-preferences-page">
            <div className="privacy-header">
                <Link href="/profile" className="privacy-back-link">
                    ← Back to Profile
                </Link>
                <h1 className="text-3xl font-extrabold mt-2 text-white">Notification Preferences</h1>
                <p className="privacy-intro">
                    Choose which notifications you receive and select your preferred delivery channels.
                    Changes are saved automatically.
                </p>
                {userEmail && (
                    <p className="text-sm mt-2 text-purple-200">
                        Configured email address: <strong>{userEmail}</strong>
                    </p>
                )}
            </div>

            {/* Status and Error Alerts */}
            {statusMessage && (
                <div
                    role="status"
                    aria-live="polite"
                    className="mb-6 p-4 rounded-lg bg-purple-900/40 border border-purple-500/50 text-purple-100 flex items-center justify-between"
                >
                    <span>{statusMessage}</span>
                </div>
            )}

            {errorMessage && (
                <div
                    role="alert"
                    aria-live="assertive"
                    className="mb-6 p-4 rounded-lg bg-red-900/50 border border-red-500/60 text-red-200"
                >
                    <span>{errorMessage}</span>
                </div>
            )}

            {/* Notification Matrix Table */}
            <div className="notification-preferences-card privacy-card" style={{ padding: '0', overflow: 'hidden' }}>
                <table className="w-full text-left border-collapse" style={{ width: '100%' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <th scope="col" style={{ padding: '1.25rem 1.5rem', width: '50%' }}>
                                <span className="text-sm font-semibold uppercase tracking-wider text-purple-300">Category</span>
                            </th>
                            <th scope="col" style={{ padding: '1.25rem 1rem', textAlign: 'center', width: '25%' }}>
                                <span className="text-sm font-semibold uppercase tracking-wider text-purple-300">In-App (Drawer)</span>
                            </th>
                            <th scope="col" style={{ padding: '1.25rem 1rem', textAlign: 'center', width: '25%' }}>
                                <span className="text-sm font-semibold uppercase tracking-wider text-purple-300">
                                    Email {userEmail ? `(${userEmail})` : ''}
                                </span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {CATEGORIES.map((cat, idx) => (
                            <tr
                                key={cat.key}
                                style={{
                                    borderBottom: idx < CATEGORIES.length - 1 ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
                                    background: idx % 2 === 1 ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
                                }}
                            >
                                <th scope="row" style={{ padding: '1.25rem 1.5rem', verticalAlign: 'middle', fontWeight: 'normal' }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                                        <span style={{ fontSize: '1.5rem', lineHeight: '1.2' }} aria-hidden="true">
                                            {cat.icon}
                                        </span>
                                        <div>
                                            <div style={{ fontWeight: '600', fontSize: '1rem', color: '#fff', marginBottom: '0.25rem' }}>
                                                {cat.title}
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)', lineHeight: '1.4' }}>
                                                {cat.description}
                                            </div>
                                        </div>
                                    </div>
                                </th>
                                {CHANNELS.map(ch => {
                                    const isChecked = preferences[cat.key]?.[ch.key] ?? false;
                                    const switchLabel = `${cat.title} ${ch.label}`;
                                    return (
                                        <td
                                            key={ch.key}
                                            data-label={ch.label}
                                            style={{
                                                padding: '1.25rem 1rem',
                                                textAlign: 'center',
                                                verticalAlign: 'middle',
                                            }}
                                        >
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={isChecked}
                                                aria-label={switchLabel}
                                                disabled={isPending}
                                                onClick={() => handleToggle(cat.key, ch.key)}
                                                style={{
                                                    position: 'relative',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    width: '48px',
                                                    height: '28px',
                                                    borderRadius: '14px',
                                                    border: 'none',
                                                    cursor: isPending ? 'not-allowed' : 'pointer',
                                                    backgroundColor: isChecked ? '#8b5cf6' : 'rgba(255, 255, 255, 0.2)',
                                                    transition: 'background-color 0.2s ease',
                                                    padding: '2px',
                                                    outline: 'none',
                                                }}
                                                className="notification-toggle-switch"
                                            >
                                                <span
                                                    style={{
                                                        display: 'inline-block',
                                                        width: '24px',
                                                        height: '24px',
                                                        borderRadius: '50%',
                                                        backgroundColor: '#ffffff',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                                        transform: isChecked ? 'translateX(20px)' : 'translateX(0)',
                                                        transition: 'transform 0.2s ease',
                                                    }}
                                                    aria-hidden="true"
                                                />
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-8 p-4 rounded-xl bg-purple-950/20 border border-purple-500/20 text-sm text-purple-200/80">
                <p>
                    💡 <strong>Delivery Tip:</strong> Operational alerts (such as flight cancellations and gate changes)
                    are critical for day-of-travel updates. Keeping at least one channel enabled ensures you never miss a schedule update.
                </p>
            </div>
        </div>
    );
}
