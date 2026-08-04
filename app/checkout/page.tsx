import type { Metadata } from 'next';
import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getOccupiedSeatsAction } from '@/app/actions';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';
import { MAX_ITINERARY_LEGS } from '@/lib/validation';

export const metadata: Metadata = {
    title: 'Checkout',
    description: 'Enter traveller details and choose a seat on every leg of your itinerary.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{
        outbound?: string | string[];
        inbound?: string | string[];
        cabin?: string | string[];
    }>;
}

const CABINS = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
type Cabin = (typeof CABINS)[number];

/** A single positive integer id, or null for anything else including a repeat. */
function flightIdParam(value: string | string[] | undefined): number | null {
    if (typeof value !== 'string') return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export default async function CheckoutPage({ searchParams }: PageProps) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        redirect('/login');
    }

    const { outbound, inbound, cabin } = await searchParams;
    // An unrecognised cabin is ignored rather than rejected: the itinerary is
    // still valid, and the wizard falls back to what the legs actually offer.
    const searchedCabin = typeof cabin === 'string' && CABINS.includes(cabin as Cabin)
        ? (cabin as Cabin)
        : undefined;
    const outboundId = flightIdParam(outbound);
    if (!outboundId) {
        notFound();
    }

    // An inbound that was asked for but cannot be read is a broken link, not a
    // one-way trip. Falling back would quietly book half of what was intended.
    const inboundId = inbound === undefined ? null : flightIdParam(inbound);
    if (inbound !== undefined && inboundId === null) {
        notFound();
    }
    if (inboundId !== null && inboundId === outboundId) {
        notFound();
    }

    const flightIds = inboundId === null ? [outboundId] : [outboundId, inboundId];
    if (flightIds.length > MAX_ITINERARY_LEGS) {
        notFound();
    }

    const found = await prisma.flight.findMany({ where: { id: { in: flightIds } } });
    const flightsById = new Map(found.map(flight => [flight.id, flight]));
    if (flightsById.size !== flightIds.length) {
        notFound();
    }

    // Ordered by the itinerary rather than by whatever the database returned.
    const flights = flightIds.map(id => {
        const flight = flightsById.get(id)!;
        return {
            id: flight.id,
            flightNumber: flight.flightNumber,
            airline: flight.airline,
            from: flight.from,
            to: flight.to,
            departureDate: flight.departureDate.toISOString(),
            price: flight.price,
            priceCents: flight.priceCents,
            firstClassRows: flight.firstClassRows,
            businessRows: flight.businessRows,
            premiumEconomyRows: flight.premiumEconomyRows,
            economyRows: flight.economyRows,
            seatPattern: flight.seatPattern,
        };
    });

    const occupiedSeats = await Promise.all(flightIds.map(id => getOccupiedSeatsAction(id)));

    return (
        <BookingCheckoutWizard
            flights={flights}
            occupiedSeats={occupiedSeats}
            cabinClass={searchedCabin}
        />
    );
}
