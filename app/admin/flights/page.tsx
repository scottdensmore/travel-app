import React from 'react';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import FlightScheduleForm from '@/components/ui/flightScheduleForm';
import AdminFlightsTable from './AdminFlightsTable';
import AdminSchedulesTableClient from '@/components/admin/AdminSchedulesTableClient';
import ManualOccurrenceBuilder from '@/components/ui/ManualOccurrenceBuilder';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import { activeItineraryLegWhere, passengersSeatedOnLeg } from '@/lib/bookingItinerary';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';

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
                    <ManualOccurrenceBuilder schedules={schedules.filter(schedule => schedule.isActive)} />
                </div>

                <div className="admin-card" style={{ height: 'fit-content' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem 0', color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                        Repeating flight templates
                    </h2>
                    <AdminSchedulesTableClient schedules={schedules} />
                </div>
            </div>

            <AdminFlightsTable initialFlights={flightsWithBookings} />
        </div>
    );
}
