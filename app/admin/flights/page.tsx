import React from 'react';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import FlightScheduleForm from '@/components/ui/flightScheduleForm';
import DeleteScheduleButton from './DeleteScheduleButton';
import FlightStatusSelector from './FlightStatusSelector';

export const dynamic = 'force-dynamic';

export default async function AdminFlightsPage() {
    const schedules = await prisma.flightSchedule.findMany({
        orderBy: { flightNumber: 'asc' }
    });

    const today = new Date();
    const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const next7Days = new Date(utcToday);
    next7Days.setUTCDate(utcToday.getUTCDate() + 7);

    const flights = await prisma.flight.findMany({
        where: {
            departureDate: {
                gte: utcToday,
                lte: next7Days
            }
        },
        orderBy: { departureDate: 'asc' }
    });

    const getDaysLabel = (days: number[]) => {
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return days.map(d => labels[d]).join(', ');
    };

    return (
        <div className="page-container admin p-8" style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="text-3xl font-bold" style={{ color: '#fff', margin: 0 }}>Manage Flights & Schedules</h1>
                <Link href="/admin" style={{ color: '#c084fc', textDecoration: 'none', fontWeight: '600' }} className="hover:underline">← Back to Dashboard</Link>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '2rem' }}>
                <div>
                    <FlightScheduleForm />
                </div>

                <div className="admin-card" style={{ height: 'fit-content' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem 0', color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                        Repeating flight templates
                    </h2>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                                    <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Flight</th>
                                    <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Route</th>
                                    <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Weekly Schedule</th>
                                    <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Price</th>
                                    <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {schedules.map(schedule => (
                                    <tr key={schedule.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                        <td style={{ padding: '12px', fontSize: '0.9rem' }}>
                                            <div style={{ fontWeight: 'bold', color: '#fff' }}>{schedule.airline}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>{schedule.flightNumber}</div>
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                            {schedule.from} → {schedule.to}
                                            <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>Departs: {schedule.departureTime} {schedule.returnTime ? `| Returns: ${schedule.returnTime}` : '(One-Way)'}</div>
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.85rem', color: '#e5e7eb' }}>
                                            {getDaysLabel(schedule.daysOfWeek)}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#34d399', fontWeight: 'bold' }}>
                                            {schedule.price}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            <DeleteScheduleButton id={schedule.id} />
                                        </td>
                                    </tr>
                                ))}
                                {schedules.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                            No flight templates declared yet. Use the form on the left to add one!
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="admin-card">
                <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem 0', color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                    Active occurrences (Next 7 Days)
                </h2>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Flight</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Route</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Departure Date</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Price</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Live Status Monitor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {flights.map(flight => (
                                <tr key={flight.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                    <td style={{ padding: '12px', fontSize: '0.9rem' }}>
                                        <div style={{ fontWeight: 'bold', color: '#fff' }}>{flight.airline}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                        {flight.from} → {flight.to}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                        <div>{new Date(flight.departureDate).toLocaleDateString()}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                                            {new Date(flight.departureDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: '0.9rem', color: '#34d399', fontWeight: 'bold' }}>
                                        {flight.price}
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                        <FlightStatusSelector id={flight.id} currentStatus={flight.status} />
                                    </td>
                                </tr>
                            ))}
                            {flights.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                        No active flight instances generated for the next 7 days.
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
