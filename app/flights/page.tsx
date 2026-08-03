import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/prisma';
import FlightStatusBoard from '@/components/ui/FlightStatusBoard';

export const metadata: Metadata = {
    title: 'Flight status',
    description: 'Check whether a Mona Airways flight is on time, delayed or cancelled.',
};

export const dynamic = 'force-dynamic';

export default async function FlightsPage() {
    const flights = await prisma.flight.findMany({
        orderBy: { departureDate: 'asc' }
    });

    return (
        <FlightStatusBoard flights={flights} />
    );
}
