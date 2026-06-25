import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getOccupiedSeatsAction } from '@/app/actions';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: {
        flightId: string;
    };
}

export default async function BookingCheckoutPage({ params }: PageProps) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        redirect('/login');
    }

    const flightId = parseInt(params.flightId, 10);
    if (isNaN(flightId)) {
        notFound();
    }

    const flight = await prisma.flight.findUnique({
        where: { id: flightId }
    });

    if (!flight) {
        notFound();
    }

    const occupiedSeats = await getOccupiedSeatsAction(flightId);

    // Format flight dates and props to pass cleanly
    const formattedFlight = {
        id: flight.id,
        flightNumber: flight.flightNumber,
        airline: flight.airline,
        from: flight.from,
        to: flight.to,
        departureDate: flight.departureDate.toISOString(),
        price: flight.price
    };

    return (
        <BookingCheckoutWizard 
            flight={formattedFlight} 
            occupiedSeats={occupiedSeats} 
        />
    );
}
