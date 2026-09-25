import type { Metadata } from 'next';
import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { flightRouteInclude } from '@/lib/flightRoute';
import { getOccupiedSeatsAction } from '@/app/actions';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';
import { MAX_ITINERARY_LEGS } from '@/lib/validation';
import {
    DEFAULT_ACCOUNT_TIME_ZONE,
    normalizeAccountTimeZone,
} from '@/lib/accountTimeZone';
import {
    getUserSpendablePointsBalance,
    grantWelcomePointsIfEligible,
} from '@/lib/pointsLedgerService';

export const metadata: Metadata = {
    title: 'Checkout',
    description: 'Enter traveller details and choose a seat on every leg of your itinerary.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{
        flights?: string | string[];
        outbound?: string | string[];
        inbound?: string | string[];
        cabin?: string | string[];
        reward?: string | string[];
    }>;
}

const CABINS = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
type Cabin = (typeof CABINS)[number];

function parseFlightIds(param: string | string[] | undefined): number[] | null {
    if (!param) return null;
    const rawTokens = Array.isArray(param)
        ? param.flatMap(p => p.split(','))
        : param.split(',');

    const ids: number[] = [];
    for (const token of rawTokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;
        const id = Number(trimmed);
        if (!Number.isInteger(id) || id <= 0) return null;
        ids.push(id);
    }
    return ids.length > 0 ? ids : null;
}

/** A single positive integer id, or null for anything else including a repeat. */
function flightIdParam(value: string | string[] | undefined): number | null {
    if (typeof value !== 'string') return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export default async function CheckoutPage({ searchParams }: PageProps) {
    const session = await getServerSession(authOptions);
    // Guards on the same thing the actions this page calls guard on. Checking
    // only `user` let a session without an id past the redirect and into
    // `getOccupiedSeatsAction`, which would throw — a 500 where a trip back to
    // sign-in belongs (#154).
    if (!session?.user?.id) {
        redirect('/login');
    }

    const { flights: flightsParam, outbound, inbound, cabin, reward } = await searchParams;
    const isRewardBooking = reward === 'true' || (Array.isArray(reward) && reward.includes('true'));
    // An unrecognised cabin is ignored rather than rejected: the itinerary is
    // still valid, and the wizard falls back to what the legs actually offer.
    const searchedCabin = typeof cabin === 'string' && CABINS.includes(cabin as Cabin)
        ? (cabin as Cabin)
        : undefined;

    let flightIds: number[];

    const parsedMulti = parseFlightIds(flightsParam);
    if (parsedMulti !== null) {
        if (parsedMulti.length > MAX_ITINERARY_LEGS) {
            notFound();
        }
        if (new Set(parsedMulti).size !== parsedMulti.length) {
            notFound();
        }
        flightIds = parsedMulti;
    } else if (flightsParam !== undefined) {
        notFound();
    } else {
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

        flightIds = inboundId === null ? [outboundId] : [outboundId, inboundId];
        if (flightIds.length > MAX_ITINERARY_LEGS) {
            notFound();
        }
    }

    await grantWelcomePointsIfEligible(session.user.id);

    const [found, account, spendablePointsBalance] = await Promise.all([
        prisma.flight.findMany({
            where: { id: { in: flightIds } },
            include: flightRouteInclude,
        }),
        prisma.user.findUniqueOrThrow({
            where: { id: session.user.id },
            select: { timeZone: true },
        }),
        getUserSpendablePointsBalance(session.user.id),
    ]);
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
            from: flight.fromAirport.label,
            to: flight.toAirport.label,
            departureDate: flight.departureDate.toISOString(),
            durationMinutes: flight.durationMinutes,
            priceCents: flight.priceCents,
            firstClassRows: flight.firstClassRows,
            businessRows: flight.businessRows,
            premiumEconomyRows: flight.premiumEconomyRows,
            economyRows: flight.economyRows,
            seatPattern: flight.seatPattern,
            awardSeatsEconomy: flight.awardSeatsEconomy,
            awardSeatsPremiumEconomy: flight.awardSeatsPremiumEconomy,
            awardSeatsBusiness: flight.awardSeatsBusiness,
            awardSeatsFirst: flight.awardSeatsFirst,
        };
    });

    const occupiedSeats = await Promise.all(flightIds.map(id => getOccupiedSeatsAction(id)));

    return (
        <BookingCheckoutWizard
            flights={flights}
            occupiedSeats={occupiedSeats}
            cabinClass={searchedCabin}
            accountTimeZone={normalizeAccountTimeZone(account.timeZone)
                ?? DEFAULT_ACCOUNT_TIME_ZONE}
            isRewardBooking={isRewardBooking}
            spendablePointsBalance={spendablePointsBalance}
        />
    );
}
