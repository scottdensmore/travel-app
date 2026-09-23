'use client';

import React, { useState } from 'react';
import { BookingStatus } from '@prisma/client';

export type BookingResult = {
    id: number;
    reference: string;
    status: BookingStatus;
    user: { name: string | null; email: string | null } | null;
    legs: Array<{ flight: { flightNumber: string; airline: string; fromAirportCode: string; toAirportCode: string; departureDate: Date } }>;
    notes?: Array<{ text: string; actorUserId: string }>;
};

type Props = {
    initialBookings: BookingResult[];
    searchAction: (query: { reference?: string; emailOrName?: string; flightNumber?: string; status?: BookingStatus }) => Promise<BookingResult[]>;
    cancelAction: (bookingId: number, reason: string, stepUpCode?: string) => Promise<unknown>;
    noteAction: (bookingId: number, note: string) => Promise<void>;
    emailAction: (bookingId: number) => Promise<unknown>;
};

export default function BookingManagementPortal({ initialBookings, searchAction, cancelAction, noteAction, emailAction }: Props) {
    const [bookings, setBookings] = useState<BookingResult[]>(initialBookings);
    const [reference, setReference] = useState('');
    const [emailOrName, setEmailOrName] = useState('');
    const [status, setStatus] = useState<BookingStatus | ''>('');
    const [loading, setLoading] = useState(false);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const results = await searchAction({
                reference: reference || undefined,
                emailOrName: emailOrName || undefined,
                status: (status as BookingStatus) || undefined,
            });
            setBookings(results);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="admin-card">
                <form onSubmit={handleSearch} className="flex gap-4">
                    <input
                        type="text"
                        placeholder="Search by Reference (MA-...)"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        className="px-4 py-2 bg-gray-800 rounded border border-gray-700 text-white"
                    />
                    <input
                        type="text"
                        placeholder="Customer Email or Name"
                        value={emailOrName}
                        onChange={(e) => setEmailOrName(e.target.value)}
                        className="px-4 py-2 bg-gray-800 rounded border border-gray-700 text-white"
                    />
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as BookingStatus)}
                        className="px-4 py-2 bg-gray-800 rounded border border-gray-700 text-white"
                    >
                        <option value="">Any Status</option>
                        <option value={BookingStatus.CONFIRMED}>Confirmed</option>
                        <option value={BookingStatus.CANCELLED}>Cancelled</option>
                        <option value={BookingStatus.DISRUPTED}>Disrupted</option>
                    </select>
                    <button type="submit" disabled={loading} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-white font-bold">
                        {loading ? 'Searching...' : 'Search'}
                    </button>
                </form>
            </div>

            <div className="admin-card">
                <h2 className="text-xl font-bold mb-4 text-purple-400">Results</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="p-2 text-gray-400">Reference</th>
                                <th className="p-2 text-gray-400">Customer</th>
                                <th className="p-2 text-gray-400">Status</th>
                                <th className="p-2 text-gray-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bookings.map((booking) => (
                                <tr key={booking.id} className="border-b border-gray-800">
                                    <td className="p-2 font-mono">{booking.reference}</td>
                                    <td className="p-2">{booking.user?.name || booking.user?.email || 'Guest'}</td>
                                    <td className="p-2">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            booking.status === 'CONFIRMED' ? 'bg-green-900 text-green-300' :
                                            booking.status === 'CANCELLED' ? 'bg-red-900 text-red-300' :
                                            'bg-yellow-900 text-yellow-300'
                                        }`}>
                                            {booking.status}
                                        </span>
                                    </td>
                                    <td className="p-2 flex gap-2">
                                        <button onClick={() => emailAction(booking.id)} className="text-blue-400 hover:underline text-sm">Resend Email</button>
                                        {booking.status !== 'CANCELLED' && (
                                            <button onClick={() => cancelAction(booking.id, 'Staff initiated cancellation')} className="text-red-400 hover:underline text-sm">Cancel</button>
                                        )}
                                        <button onClick={() => noteAction(booking.id, 'Support handoff note...')} className="text-gray-400 hover:underline text-sm">Add Note</button>
                                    </td>
                                </tr>
                            ))}
                            {bookings.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-4 text-center text-gray-500">No bookings found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
