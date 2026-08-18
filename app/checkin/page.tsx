import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serverRenderTime } from '@/lib/serverClock';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import {
    activeItineraryLegWhere,
    cabinLabel,
    legDirectionLabel,
    orderedLegs,
    passengersSeatedOnLeg,
    seatLabel,
} from '@/lib/bookingItinerary';
import { departureInOriginZone, flightDeparture } from '@/lib/flightTime';
import { airportTimeZoneFor } from '@/lib/airports';
import { checkInNextStep, legCheckInEligibility } from '@/lib/checkInPolicy';
import CheckInPanel, { type CheckInLegView } from '@/components/ui/CheckInPanel';

export const metadata: Metadata = {
    title: 'Check in',
    description: 'Check in for your Mona Airways flights and confirm your seats.',
};

export const dynamic = 'force-dynamic';

/**
 * How much of a customer's travel a check-in page is for.
 *
 * Bounded on both sides, and bounded deliberately: `/flights` served every
 * flight ever scheduled into an RSC payload because its query had no limit at
 * all (#153), and a booking history grows without end the same way.
 *
 * The window reaches back two hours so that a flight which has just left is
 * explained rather than silently absent -- "this flight has departed" is one of
 * the clear reasons #77 asks for, and a leg that vanishes gives none. It reaches
 * forward a month because check-in opens a day before departure and a customer
 * looking further ahead is asking when it opens, which needs the leg on screen
 * to answer.
 */
const HISTORY_HOURS = 2;
const HORIZON_DAYS = 30;

/**
 * How far back to reach for a flight the airline has marked delayed.
 *
 * `Flight.departureDate` is the *scheduled* instant and a delay does not move it
 * -- the same fact `checkInPolicy` refuses to call a delayed flight departed for.
 * Bounding every leg at `HISTORY_HOURS` therefore dropped a flight delayed longer
 * than that off this page while the customer was still standing in the terminal
 * waiting for it, which is precisely when they would come looking.
 */
const DELAYED_HISTORY_HOURS = 24;

/** A ceiling for a customer with more travel than the window expects. */
const MAX_LEGS = 60;

/** How a check-in state reads as a short label beside the flight. */
const STATUS_LABELS = {
    OPEN: 'Check-in open',
    NOT_YET_OPEN: 'Check-in not open yet',
    CLOSED: 'Check-in closed',
    DEPARTED: 'Departed',
    FLIGHT_CANCELLED: 'Flight cancelled',
    BOOKING_CANCELLED: 'Booking cancelled',
    BOOKING_DISRUPTED: 'Flights changed',
    ALREADY_CHECKED_IN: 'Checked in',
    NOT_TRAVELLING: 'No seat held',
} as const;

export default async function CheckInPage() {
    const session = await getServerSession(authOptions);
    // Read rather than called in the markup below: see lib/serverClock.
    const renderedAt = await serverRenderTime();

    if (!session?.user?.id) {
        return (
            <div className="page-container checkin">
                <div className="checkin-shell">
                    <h1>Check in</h1>
                    <p className="checkin-empty">
                        Please <Link href="/login">log in</Link> to check in for your flights.
                    </p>
                </div>
            </div>
        );
    }

    const windowStart = new Date(renderedAt - HISTORY_HOURS * 60 * 60 * 1000);
    const delayedStart = new Date(renderedAt - DELAYED_HISTORY_HOURS * 60 * 60 * 1000);
    const windowEnd = new Date(renderedAt + HORIZON_DAYS * 24 * 60 * 60 * 1000);

    // Scoped to the authenticated owner in the query itself, so no later filter
    // can be the only thing standing between one customer and another's
    // itinerary. A booking's reference is an identifier rather than a
    // credential, and this is the scope that makes that safe (#77).
    const legs = await prisma.itineraryLeg.findMany({
        where: {
            ...activeItineraryLegWhere,
            booking: { userId: session.user.id },
            flight: {
                OR: [
                    { departureDate: { gte: windowStart, lte: windowEnd } },
                    // A delayed flight keeps its scheduled instant, so it needs a
                    // longer reach back or it vanishes mid-delay.
                    {
                        status: 'DELAYED',
                        departureDate: { gte: delayedStart, lte: windowEnd },
                    },
                ],
            },
        },
        orderBy: [{ flight: { departureDate: 'asc' } }, { sequence: 'asc' }],
        take: MAX_LEGS,
        select: {
            id: true,
            sequence: true,
            booking: {
                select: {
                    id: true,
                    reference: true,
                    status: true,
                    passengers: {
                        select: {
                            ...safePassengerSelect,
                            // Safe on a customer projection precisely because it
                            // is a timestamp: it records that an attestation
                            // happened and reveals nothing that was attested to
                            // (docs/PASSENGER_DATA_POLICY.md).
                            documentsConfirmedAt: true,
                        },
                    },
                    // Only to count the itinerary's positions, which is what
                    // `legDirectionLabel` needs to say "Returning" rather than
                    // "Leg 2". Selecting the whole leg would carry a second copy
                    // of every flight into the payload.
                    legs: {
                        where: activeItineraryLegWhere,
                        select: { id: true, sequence: true },
                        orderBy: { sequence: 'asc' },
                    },
                },
            },
            flight: {
                select: {
                    airline: true,
                    flightNumber: true,
                    departureDate: true,
                    status: true,
                    ...flightRouteInclude,
                },
            },
            seatAssignments: {
                select: {
                    passengerId: true,
                    seatNumber: true,
                    cabinClass: true,
                    releasedAt: true,
                    checkedInAt: true,
                },
            },
        },
    });

    const views: CheckInLegView[] = legs.map((leg) => {
        const flight = withRouteLabels(leg.flight);
        const eligibility = legCheckInEligibility({
            departsAt: leg.flight.departureDate,
            flightStatus: leg.flight.status,
            bookingStatus: leg.booking.status,
            seats: leg.seatAssignments,
        }, new Date(renderedAt));

        const departure = flightDeparture(flight);
        // Every window boundary is read at the origin airport, beside the
        // departure it is derived from. An account timezone would put the two
        // times on one line in two different zones (#302 chose the account zone
        // for account events; a departure is not one).
        const boundary = (instant: Date) => {
            // `departureInOriginZone` rather than `flightDeparture`: the latter
            // renders a *departure*, and a check-in window boundary is not one.
            // It resolved the zone from the same airport and gave the same
            // string, so this is a category correction rather than a fix -- but
            // the next reader should not have to work out why a boundary was
            // being asked for as a departure.
            const local = departureInOriginZone(instant, airportTimeZoneFor(flight.from));
            return `${local.readableDate} at ${local.time} ${local.zoneLabel}`;
        };

        const positions = orderedLegs({ legs: leg.booking.legs });
        // Only a booking with more than one leg has a direction. A single-leg
        // booking labelled "Departing" makes three interleaved bookings read as
        // one itinerary -- "Departing / Departing / Returning" -- where only the
        // confirmation reference says otherwise.
        const directionLabel = positions.length > 1
            ? legDirectionLabel(
                positions.findIndex(position => position.id === leg.id),
                positions.length,
            )
            : '';
        const travellers = passengersSeatedOnLeg(leg, leg.booking.passengers)
            .filter(traveller => !traveller.releasedAt)
            .map(traveller => ({
                id: traveller.id,
                name: `${traveller.firstName} ${traveller.lastName}`,
                seat: seatLabel(traveller),
                cabin: cabinLabel(traveller.cabinClass),
                checkedIn: leg.seatAssignments.some(
                    seat => seat.passengerId === traveller.id && seat.checkedInAt !== null,
                ),
            }));

        return {
            bookingId: leg.booking.id,
            legId: leg.id,
            reference: leg.booking.reference,
            directionLabel,
            airline: flight.airline,
            flightNumber: flight.flightNumber,
            from: flight.from,
            to: flight.to,
            departureReadable: `${departure.readableDate} at ${departure.time} ${departure.zoneLabel}`,
            opensAtReadable: boundary(eligibility.opensAt),
            closesAtReadable: boundary(eligibility.closesAt),
            allowed: eligibility.allowed,
            reason: eligibility.reason,
            // Whether the window has opened, decided against the same server
            // instant everything else on the card is. Derived from the boundary
            // rather than from the reason: a cancelled booking three weeks out is
            // not NOT_YET_OPEN, but its opening time is still in the future, and
            // labelling that "opened" was the contradiction this replaces.
            hasOpened: eligibility.opensAt.getTime() <= renderedAt,
            // Asked once per booking rather than once per leg, because a passport
            // does not change between an outbound and a return. Every traveller
            // on the booking, not only those seated on this leg: the attestation
            // covers the party the owner is acting for.
            documentsConfirmed: leg.booking.passengers
                .every(passenger => passenger.documentsConfirmedAt !== null),
            statusLabel: STATUS_LABELS[eligibility.reason],
            nextStep: checkInNextStep(eligibility.reason),
            awaiting: eligibility.awaiting,
            travellers,
        };
    });

    return <CheckInPanel legs={views} />;
}
