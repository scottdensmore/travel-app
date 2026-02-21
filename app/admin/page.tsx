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
        <div className="page-container p-8" style={{ marginTop: '100px' }}>
            <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                    <h2 className="text-gray-500 font-semibold mb-2">Total Users</h2>
                    <p className="text-4xl font-bold text-blue-600">{userCount}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                    <h2 className="text-gray-500 font-semibold mb-2">Total Bookings</h2>
                    <p className="text-4xl font-bold text-green-600">{bookingCount}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                    <h2 className="text-gray-500 font-semibold mb-2">City Guides</h2>
                    <p className="text-4xl font-bold text-purple-600">{cityGuideCount}</p>
                </div>
            </div>

            <div className="mb-8 flex gap-4">
                <Link href="/admin/travelguide" className="inline-block bg-blue-600 text-white px-6 py-2 rounded font-semibold hover:bg-blue-700" style={{ textDecoration: 'none', background: '#2563EB', padding: '0.5rem 1.5rem', borderRadius: '4px', color: 'white' }}>
                    Manage City Guides
                </Link>
            </div>

            <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                    <h2 className="font-bold text-lg text-gray-800">Recent Bookings</h2>
                </div>
                <div className="p-0">
                    {recentBookings.length > 0 ? (
                        <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">User</th>
                                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Flight</th>
                                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Route</th>
                                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Date</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {recentBookings.map((booking) => {
                                    const b = booking.flight || booking;
                                    return (
                                        <tr key={booking.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-b">{booking.user?.name || booking.user?.email || 'Guest'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-b">{b.airline} {b.flightNumber}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">{b.from} → {b.to}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">{new Date(booking.createdAt).toLocaleDateString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <div className="p-6 text-gray-500">No recent bookings.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
