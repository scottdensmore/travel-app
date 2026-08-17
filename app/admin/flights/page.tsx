import React from 'react';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import FlightScheduleForm from '@/components/ui/flightScheduleForm';
import DeleteScheduleButton from './DeleteScheduleButton';
import AdminFlightsTable from './AdminFlightsTable';
import ManualOccurrenceBuilder from '@/components/ui/ManualOccurrenceBuilder';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import { activeItineraryLegWhere, passengersSeatedOnLeg } from '@/lib/bookingItinerary';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { formatPrice } from '@/lib/bookingPricing';
import { durationLabel } from '@/lib/flightTime';

export const dynamic = 'force-dynamic';

export default async function AdminFlightsPage() {
    const schedules = await prisma.flightSchedule.findMany({
        orderBy: { flightNumber: 'asc' }
    });

    // This board spans every origin, so it has no single local calendar day.
    // "Next 7 Days" is a rolling operational horizon from this request's
    // instant, not seven UTC dates (which clipped Miami and admitted Tokyo at
    // opposite edges). Keep the upper bound half-open so adjacent windows do
    // not both claim an occurrence exactly seven days away (#235).
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const flights = await prisma.flight.findMany({
        where: {
            departureDate: {
                gte: windowStart,
                lt: windowEnd
            }
        },
        include: {
            ...flightRouteInclude,
            itineraryLegs: {
                where: activeItineraryLegWhere,
                include: {
                    // The seats held on this flight. A traveller on a round trip
                    // sits somewhere else on the other leg, so the manifest has
                    // to read the assignment rather than Passenger.seatNumber.
                    seatAssignments: {
                        select: {
                            passengerId: true,
                            seatNumber: true,
                            cabinClass: true,
                            // Without this the manifest prints a released seat
                            // as a live one, and lists two travellers in it.
                            releasedAt: true,
                        }
                    },
                    booking: {
                        include: {
                            passengers: { select: safePassengerSelect }
                        }
                    }
                }
            }
        },
        orderBy: { departureDate: 'asc' }
    });

    const getDaysLabel = (days: number[]) => {
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return days.map(d => labels[d]).join(', ');
    };

    const flightsWithBookings = flights.map(({ itineraryLegs, ...flight }) => ({
        ...withRouteLabels(flight),
        bookings: itineraryLegs.map((leg) => ({
            ...leg.booking,
            passengers: passengersSeatedOnLeg(leg, leg.booking.passengers),
        })),
    }));

    return (
        <div className="page-container admin p-8" style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="text-3xl font-bold" style={{ color: '#fff', margin: 0 }}>Manage Flights & Schedules</h1>
                <Link href="/admin" style={{ color: '#c084fc', textDecoration: 'none', fontWeight: '600' }} className="hover:underline">← Back to Dashboard</Link>
            </div>

            <div className="admin-flights-layout">
                <div>
                    <FlightScheduleForm />
                    <ManualOccurrenceBuilder schedules={schedules} />
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
                                    <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Duration</th>
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
                                            <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>Departs: {schedule.departureTime}</div>
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.85rem', color: '#e5e7eb' }}>
                                            {getDaysLabel(schedule.daysOfWeek)}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#e5e7eb', whiteSpace: 'nowrap' }}>
                                            {durationLabel(schedule.durationMinutes)}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#34d399', fontWeight: 'bold' }}>
                                            {formatPrice(schedule.priceCents ?? 0)}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                                <Link
                                                    href={`/admin/flights/schedules/${schedule.id}`}
                                                    style={{ color: '#7dd3fc', fontWeight: 700, whiteSpace: 'nowrap' }}
                                                >
                                                    Preview impact
                                                </Link>
                                                <DeleteScheduleButton id={schedule.id} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {schedules.length === 0 && (
                                    <tr>
                                        <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                            No flight templates declared yet. Use the form on the left to add one!
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <AdminFlightsTable initialFlights={flightsWithBookings} />
        </div>
    );
}
