import React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { prisma } from '@/lib/prisma';
import { flightRouteInclude, withLegRouteLabels } from '@/lib/flightRoute';
import Link from 'next/link';
import { activeItineraryLegWhere, outboundFlight } from '@/lib/bookingItinerary';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
    const session = await getServerSession(authOptions);

    const userCount = await prisma.user.count();
    const bookingCount = await prisma.booking.count();
    const cityGuideCount = await prisma.cityGuide.count();

    const canReadBookings = hasStaffPermission(session, StaffPermission.BOOKINGS_READ);
    const canReadSchedules = hasStaffPermission(session, StaffPermission.SCHEDULES_READ);
    const canRefundBookings = hasStaffPermission(session, StaffPermission.BOOKINGS_REFUND);
    const canWriteCityGuides = hasStaffPermission(session, StaffPermission.CITY_GUIDES_WRITE);
    const canModerateReviews = hasStaffPermission(session, StaffPermission.REVIEWS_MODERATE);
    const canReadNotifications = hasStaffPermission(session, StaffPermission.NOTIFICATIONS_READ);
    const canManageRoles = hasStaffPermission(session, StaffPermission.USERS_MANAGE_ROLES);
    const canViewAuditLogs = hasStaffPermission(session, StaffPermission.AUDIT_LOGS_VIEW);

    // Recent bookings - only queried if staff member has BOOKINGS_READ permission
    const recentBookings = canReadBookings
        ? await prisma.booking.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
                legs: {
                    where: activeItineraryLegWhere,
                    include: { flight: { include: flightRouteInclude } },
                    orderBy: { sequence: 'asc' },
                },
            },
        })
        : [];

    return (
        <div className="page-container admin p-8" style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <h1 className="text-3xl font-bold" style={{ color: '#fff', margin: 0 }}>Admin Control Center</h1>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                <div className="admin-card" style={{ marginBottom: 0, padding: '24px' }}>
                    <h2 className="text-gray-400 font-semibold mb-2" style={{ borderBottom: 'none', paddingBottom: 0, fontSize: '1rem', color: '#a78bfa' }}>Total Users</h2>
                    <p className="text-4xl font-bold" style={{ color: '#38bdf8', fontSize: '2.25rem', margin: '8px 0 0 0', fontWeight: 'bold' }}>{userCount}</p>
                </div>
                <div className="admin-card" style={{ marginBottom: 0, padding: '24px' }}>
                    <h2 className="text-gray-400 font-semibold mb-2" style={{ borderBottom: 'none', paddingBottom: 0, fontSize: '1rem', color: '#a78bfa' }}>Total Bookings</h2>
                    <p className="text-4xl font-bold" style={{ color: '#34d399', fontSize: '2.25rem', margin: '8px 0 0 0', fontWeight: 'bold' }}>{bookingCount}</p>
                </div>
                <div className="admin-card" style={{ marginBottom: 0, padding: '24px' }}>
                    <h2 className="text-gray-400 font-semibold mb-2" style={{ borderBottom: 'none', paddingBottom: 0, fontSize: '1rem', color: '#a78bfa' }}>City Guides</h2>
                    <p className="text-4xl font-bold" style={{ color: '#c084fc', fontSize: '2.25rem', margin: '8px 0 0 0', fontWeight: 'bold' }}>{cityGuideCount}</p>
                </div>
            </div>

            {/* Admin Management Sections */}
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                {canWriteCityGuides && (
                    <Link href="/admin/travelguide" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>City Guides</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Create, update, and manage travel guide locations, coordinates, and recommendations.
                        </p>
                    </Link>
                )}

                {canReadSchedules && (
                    <Link href="/admin/flights" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>Flight & Schedule Manager</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Create recurring schedules, automatically generate daily occurrences, and monitor/update live statuses.
                        </p>
                    </Link>
                )}

                {canRefundBookings && (
                    <Link href="/admin/payments" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>Payment Recovery</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Review stale provider-backed checkouts and refresh their current Stripe status.
                        </p>
                    </Link>
                )}

                {canReadBookings && (
                    <Link href="/admin/bookings" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>Customer Support</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Search and manage bookings, process cancellations, resend documents, and leave notes.
                        </p>
                    </Link>
                )}

                {canModerateReviews && (
                    <Link href="/admin/reviews" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>Review Moderation</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Moderate traveler reviews, inspect reported issues, resolve flags, and view moderation audit history.
                        </p>
                    </Link>
                )}

                {canReadNotifications && (
                    <Link href="/admin/notifications" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>Notification Deliveries</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Audit multi-channel dispatch logs, inspect delivery failures, and retry stalled notifications.
                        </p>
                    </Link>
                )}

                {canManageRoles && (
                    <Link href="/admin/users" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>User Role Management</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Review user permissions, promote or demote staff, and adjust role access.
                        </p>
                    </Link>
                )}

                {canViewAuditLogs && (
                    <Link href="/admin/audit" className="admin-card hover:border-purple-500 transition-all" style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '250px',
                        padding: '24px',
                        marginBottom: 0,
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <h3 style={{ color: '#c084fc', fontSize: '1.25rem', margin: 0, fontWeight: 'bold' }}>Staff Audit Trail</h3>
                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem', margin: 0 }}>
                            Inspect historical staff operations, audit state diffs, and manage retention purge policies.
                        </p>
                    </Link>
                )}
            </div>

            {/* Recent Bookings List */}
            {canReadBookings && (
                <div className="admin-card">
                    <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem 0', color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                        Recent Bookings
                    </h2>
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
                                {recentBookings.map((booking) => {
                                    const flight = outboundFlight({ ...booking, legs: booking.legs.map(withLegRouteLabels) });
                                    return (
                                        <tr key={booking.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                            <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                                {booking.user?.name || booking.user?.email || 'Guest'}
                                            </td>
                                            <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                                {flight ? `${flight.airline} ${flight.flightNumber}` : '—'}
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
                                {recentBookings.length === 0 && (
                                    <tr>
                                        <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                            No recent bookings.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
