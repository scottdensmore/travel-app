import React from 'react';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
    const users = await prisma.user.findMany({
        orderBy: { email: 'asc' },
        include: { _count: { select: { bookings: true, reviews: true, favorites: true } } }
    });

    return (
        <div className="page-container p-8" style={{ marginTop: '100px' }}>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Manage Users</h1>
                <Link href="/admin" className="text-blue-600 hover:underline">← Back to Dashboard</Link>
            </div>

            <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                <div className="p-0">
                    <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Name</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Email</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Role</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Bookings</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Reviews</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Favorites</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {users.map((user) => (
                                <tr key={user.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-b">{user.name || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">{user.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">
                                        <span className={`px-2 py-1 rounded text-xs font-semibold ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">{user._count.bookings}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">{user._count.reviews}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-b">{user._count.favorites}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
