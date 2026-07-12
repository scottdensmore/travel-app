import React from 'react';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
    const userCount = await prisma.user.count();
    const bookingCount = await prisma.booking.count();
    const cityGuideCount = await prisma.cityGuide.count();

    // Recent bookings
    const recentBookings = await prisma.booking.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: true, flight: true }
    });

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
            </div>

            {/* Recent Bookings List */}
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
                                const flight = booking.flight;
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
        </div>
    );
}
