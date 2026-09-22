'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    NotificationDeliveryWithNotification,
    getAdminNotificationDeliveriesAction,
    retryNotificationDeliveryAction,
} from '@/app/actions/notificationActions';

export interface AdminNotificationDeliveriesClientProps {
    initialDeliveries: NotificationDeliveryWithNotification[];
    totalCount: number;
    sentCount?: number;
    failedCount?: number;
    pendingCount?: number;
}

type StatusTab = 'ALL' | 'FAILED' | 'SENT' | 'PENDING';
type ChannelFilter = 'ALL' | 'EMAIL' | 'IN_APP';

export default function AdminNotificationDeliveriesClient({
    initialDeliveries,
    totalCount,
    sentCount,
    failedCount,
    pendingCount,
}: AdminNotificationDeliveriesClientProps) {
    const router = useRouter();
    const [deliveries, setDeliveries] = useState<NotificationDeliveryWithNotification[]>(initialDeliveries);
    const [activeTab, setActiveTab] = useState<StatusTab>('ALL');
    const [selectedChannel, setSelectedChannel] = useState<ChannelFilter>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [retryingIds, setRetryingIds] = useState<Record<string, boolean>>({});
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [isPending, startTransition] = useTransition();

    const [counts, setCounts] = useState({
        total: totalCount,
        sent: sentCount ?? initialDeliveries.filter(d => d.status === 'SENT').length,
        failed: failedCount ?? initialDeliveries.filter(d => d.status === 'FAILED').length,
        pending: pendingCount ?? initialDeliveries.filter(d => d.status === 'PENDING').length,
    });

    const fetchDeliveries = async (tab: StatusTab, channel: ChannelFilter, search: string) => {
        setFeedback(null);
        startTransition(async () => {
            try {
                const queryStatus = tab === 'ALL' ? undefined : tab;
                const queryChannel = channel === 'ALL' ? undefined : channel;
                const querySearch = search.trim() ? search.trim() : undefined;

                const result = await getAdminNotificationDeliveriesAction({
                    status: queryStatus,
                    channel: queryChannel,
                    search: querySearch,
                    page: 1,
                    pageSize: 50,
                });

                if (result.ok) {
                    setDeliveries(result.data.deliveries);
                } else {
                    setFeedback({ type: 'error', message: result.error?.message || 'Failed to fetch deliveries.' });
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Error fetching deliveries.';
                setFeedback({ type: 'error', message: msg });
            }
        });
    };

    const handleTabChange = (tab: StatusTab) => {
        setActiveTab(tab);
        fetchDeliveries(tab, selectedChannel, searchQuery);
    };

    const handleChannelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const channel = e.target.value as ChannelFilter;
        setSelectedChannel(channel);
        fetchDeliveries(activeTab, channel, searchQuery);
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        fetchDeliveries(activeTab, selectedChannel, searchQuery);
    };

    const handleRetry = async (deliveryId: string) => {
        setRetryingIds(prev => ({ ...prev, [deliveryId]: true }));
        setFeedback(null);

        try {
            const result = await retryNotificationDeliveryAction(deliveryId);

            if (!result.ok) {
                setFeedback({
                    type: 'error',
                    message: result.error?.message || 'Failed to retry notification delivery.',
                });
                return;
            }

            // Update local delivery item
            setDeliveries(prev =>
                prev.map(del => {
                    if (del.id !== deliveryId) return del;
                    if (result.data.delivery) {
                        return result.data.delivery;
                    }
                    return {
                        ...del,
                        status: 'SENT',
                        error: null,
                        attempts: del.attempts + 1,
                    };
                })
            );

            // Update counts
            setCounts(prev => ({
                ...prev,
                failed: Math.max(0, prev.failed - 1),
                sent: prev.sent + 1,
            }));

            setFeedback({
                type: 'success',
                message: `Delivery ${deliveryId} retried successfully.`,
            });
            router.refresh();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'An unexpected error occurred while retrying.';
            setFeedback({ type: 'error', message: msg });
        } finally {
            setRetryingIds(prev => ({ ...prev, [deliveryId]: false }));
        }
    };

    const formatCategory = (category: string) => {
        switch (category) {
            case 'FLIGHT_STATUS':
                return 'Flight Status';
            case 'ACCOUNT_ACTIVITY':
                return 'Account Activity';
            case 'TRAVEL_GUIDES':
                return 'Travel Guides';
            default:
                return category;
        }
    };

    const formatChannel = (channel: string) => {
        switch (channel) {
            case 'EMAIL':
                return 'Email';
            case 'IN_APP':
                return 'In-App';
            default:
                return channel;
        }
    };

    const getStatusBadgeClass = (status: string) => {
        switch (status) {
            case 'SENT':
                return 'bg-emerald-900/60 text-emerald-400 border-emerald-700/60';
            case 'FAILED':
                return 'bg-rose-900/60 text-rose-400 border-rose-700/60';
            case 'PENDING':
                return 'bg-amber-900/60 text-amber-400 border-amber-700/60';
            default:
                return 'bg-gray-800 text-gray-300 border-gray-700';
        }
    };

    return (
        <div className="space-y-6">
            {/* Feedback alert */}
            {feedback && (
                <div
                    role={feedback.type === 'error' ? 'alert' : 'status'}
                    className={`p-4 rounded-lg font-medium border ${
                        feedback.type === 'error'
                            ? 'bg-red-900/80 border-red-500 text-red-200'
                            : 'bg-emerald-900/80 border-emerald-500 text-emerald-200'
                    }`}
                >
                    {feedback.message}
                </div>
            )}

            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="admin-card p-5 bg-gray-800/80 border border-gray-700/60 rounded-xl">
                    <h3 className="text-sm font-semibold text-gray-400">Total Dispatches</h3>
                    <p className="text-3xl font-bold text-purple-400 mt-2">{counts.total}</p>
                </div>
                <div className="admin-card p-5 bg-gray-800/80 border border-gray-700/60 rounded-xl">
                    <h3 className="text-sm font-semibold text-gray-400">Sent Count</h3>
                    <p className="text-3xl font-bold text-emerald-400 mt-2">{counts.sent}</p>
                </div>
                <div className="admin-card p-5 bg-gray-800/80 border border-gray-700/60 rounded-xl">
                    <h3 className="text-sm font-semibold text-gray-400">Failed Count</h3>
                    <p className="text-3xl font-bold text-rose-400 mt-2">{counts.failed}</p>
                </div>
                <div className="admin-card p-5 bg-gray-800/80 border border-gray-700/60 rounded-xl">
                    <h3 className="text-sm font-semibold text-gray-400">Pending Count</h3>
                    <p className="text-3xl font-bold text-amber-400 mt-2">{counts.pending}</p>
                </div>
            </div>

            {/* Filter controls & Search */}
            <div className="admin-card p-4 bg-gray-800/80 border border-gray-700/60 rounded-xl space-y-4">
                {/* Tabs */}
                <div className="flex border-b border-gray-700 gap-2 overflow-x-auto" role="tablist">
                    {(['ALL', 'FAILED', 'SENT', 'PENDING'] as StatusTab[]).map(tab => (
                        <button
                            key={tab}
                            role="tab"
                            id={`tab-${tab.toLowerCase()}`}
                            aria-selected={activeTab === tab}
                            onClick={() => handleTabChange(tab)}
                            className={`px-4 py-2.5 font-semibold text-sm transition-colors border-b-2 capitalize whitespace-nowrap ${
                                activeTab === tab
                                    ? 'border-purple-500 text-purple-400'
                                    : 'border-transparent text-gray-400 hover:text-gray-200'
                            }`}
                        >
                            {tab === 'ALL' ? 'All Deliveries' : tab.charAt(0) + tab.slice(1).toLowerCase()}
                        </button>
                    ))}
                </div>

                {/* Filter bar */}
                <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-4 pt-2">
                    <div className="flex items-center gap-2">
                        <label htmlFor="channel-filter" className="text-sm font-medium text-gray-300">
                            Channel:
                        </label>
                        <select
                            id="channel-filter"
                            aria-label="Channel"
                            value={selectedChannel}
                            onChange={handleChannelChange}
                            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        >
                            <option value="ALL">All Channels</option>
                            <option value="EMAIL">Email</option>
                            <option value="IN_APP">In-App</option>
                        </select>
                    </div>

                    <div className="flex flex-1 min-w-[240px] items-center gap-2">
                        <input
                            type="text"
                            aria-label="Search notification deliveries"
                            placeholder="Search by recipient, error, title, message..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-400 focus:outline-none focus:border-purple-500"
                        />
                        <button
                            type="submit"
                            disabled={isPending}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
                        >
                            {isPending ? 'Searching...' : 'Search'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Deliveries audit table */}
            <div className="admin-card overflow-hidden bg-gray-800/80 border border-gray-700/60 rounded-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-700/80 bg-gray-900/40 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                <th className="p-3">Timestamp</th>
                                <th className="p-3">Category</th>
                                <th className="p-3">Channel</th>
                                <th className="p-3">Recipient</th>
                                <th className="p-3">Notification</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Attempts</th>
                                <th className="p-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/40 text-sm">
                            {deliveries.map(del => {
                                const isRetrying = !!retryingIds[del.id];
                                return (
                                    <tr key={del.id} className="hover:bg-gray-750/30 transition-colors">
                                        <td className="p-3 text-gray-400 whitespace-nowrap text-xs">
                                            {new Date(del.createdAt).toLocaleString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-900/40 text-purple-300 border border-purple-700/40">
                                                {formatCategory(del.notification.category)}
                                            </span>
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                                                {formatChannel(del.channel)}
                                            </span>
                                        </td>
                                        <td className="p-3 font-mono text-xs text-gray-200 max-w-[180px] truncate" title={del.recipient}>
                                            {del.recipient}
                                        </td>
                                        <td className="p-3 max-w-[260px]">
                                            <div className="font-semibold text-white truncate" title={del.notification.title}>
                                                {del.notification.title}
                                            </div>
                                            <div className="text-gray-400 text-xs line-clamp-1 truncate" title={del.notification.message}>
                                                {del.notification.message}
                                            </div>
                                            {/* Error inspector for failed deliveries */}
                                            {del.error && (
                                                <div
                                                    className="mt-1 text-xs font-mono bg-red-950/70 text-red-300 p-2 rounded border border-red-800/60 break-words"
                                                    title={del.error}
                                                >
                                                    <span className="font-semibold text-red-400 mr-1">Error:</span>
                                                    {del.error}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                            <span
                                                className={`px-2.5 py-1 text-xs font-bold rounded-full border ${getStatusBadgeClass(
                                                    del.status
                                                )}`}
                                            >
                                                {del.status}
                                            </span>
                                        </td>
                                        <td className="p-3 whitespace-nowrap text-gray-300 text-xs">
                                            {del.attempts}
                                        </td>
                                        <td className="p-3 whitespace-nowrap text-right">
                                            {del.status === 'FAILED' && (
                                                <button
                                                    onClick={() => handleRetry(del.id)}
                                                    disabled={isRetrying}
                                                    aria-label={`Retry delivery ${del.id}`}
                                                    className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded shadow transition-all"
                                                >
                                                    {isRetrying ? 'Retrying...' : 'Retry'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {deliveries.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-gray-400">
                                        No notification deliveries found matching the criteria.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
