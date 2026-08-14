'use server'

import { revalidatePath } from 'next/cache';
import {
    checkoutHolderKey,
    holdSeats,
    SeatHoldUnavailableError,
    seatsOnHold,
} from '@/lib/seatHolds';
import { heldSeats } from '@/lib/seatOccupancy';
import TravelGuideService from '@/lib/TravelGuideService';
import FlightBookingService, { PassengerInput } from '@/lib/FlightBookingService';
import CityGuide from '@/lib/types/CityGuide';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';
import type { Flight } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin, validateSeatingLayout } from '@/lib/seatLayout';
import { lockBookingsOnFlightForUpdate, lockFlightForUpdate } from '@/lib/flightLock';
import { updateFlightSeatingLayout } from '@/lib/FlightSeatLayoutService';
import { actionValidationFailure, actionValidationFailures } from '@/lib/actionResult';
import {
    bookingTotalCents,
    calculatePassengerFareCents,
    flightFareCents,
    parsePriceToCents,
    type CabinClass,
} from '@/lib/bookingPricing';
import { bookingFlights, outboundFlight } from '@/lib/bookingItinerary';
import { cancellableBooking, cancellationNote, cancellationOutcome } from '@/lib/cancellationPolicy';
import { buildFlightRoutes, findNearbyOperatingDates } from '@/lib/flightSearch';
import { airportCodeFor, airportCodesForRoute, airportTimeZoneFor } from '@/lib/airports';
import { airportDayBounds, airportLocalInstant } from '@/lib/flightTime';
import { flightRouteInclude, flightRouteWhere, withRouteLabels } from '@/lib/flightRoute';
import type { RoutedFlight } from '@/lib/flightRoute';
import { bookingWindowIsoDates } from '@/lib/dates';
import {
    bookingRequestSchema,
    cityGuideSchema,
    favoriteSchema,
    flightStatusSchema,
    numericIdSchema,
    occurrenceRequestSchema,
    parseActionInput,
    parseInput,
    reviewSchema,
    scheduleSchema,
    searchFlightsSchema,
    seatChangesSchema,
    checkoutSeatClaimsSchema,
    stringIdSchema
} from '@/lib/validation';

/**
 * A schedule's departure on one date, as the instant it names.
 *
 * The schedule states a wall clock at the origin. Stapling a `Z` on it -- which
 * both admin writers did after `FlightScheduleService` stopped -- stored a
 * Tokyo 08:00 departure as 08:00Z, nine hours late, and on the wrong day for
 * anything departing after 15:00 local. It also meant a staff-generated
 * occurrence and a scheduler-generated one for the same flight and date got
 * different values, so the unique pair could not stop them coexisting (#84).
 */
function departureInstantFor(
    isoDate: string,
    schedule: { from: string; departureTime: string },
): Date {
    const originZone = airportTimeZoneFor(schedule.from);
    return originZone
        ? airportLocalInstant(isoDate, schedule.departureTime, originZone)
        : new Date(`${isoDate}T${schedule.departureTime}:00Z`);
}

const travelGuideService = new TravelGuideService();
const flightBookingService = new FlightBookingService();

export async function saveCityGuideAction(cityGuide: CityGuide) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsed = parseActionInput(cityGuideSchema, cityGuide);
    if (!parsed.ok) return parsed;
    const result = await travelGuideService.saveCityGuide(parsed.data as CityGuide);
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
    return result;
}

export async function deleteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsed = parseActionInput(numericIdSchema, cityGuideId);
    if (!parsed.ok) return parsed;
    cityGuideId = parsed.data;
    await prisma.cityGuide.delete({
        where: { id: cityGuideId }
    });
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
}

export async function searchFlightsAction(
    from: string,
    to: string,
    departureDateStr?: string,
    returnDateStr?: string,
    cabinClass?: CabinClass,
) {
    const parsed = parseActionInput(searchFlightsSchema, {
        from,
        to,
        departureDate: departureDateStr === '' || departureDateStr === undefined
            ? undefined
            : departureDateStr,
        returnDate: returnDateStr === '' || returnDateStr === undefined
            ? undefined
            : returnDateStr,
        ...(cabinClass === undefined ? {} : { cabinClass }),
    });
    if (!parsed.ok) return parsed;
    ({ from, to, departureDate: departureDateStr, returnDate: returnDateStr } = parsed.data);
    const cabin = parsed.data.cabinClass;

    if (!departureDateStr) {
        const route = flightRouteWhere(from, to);
        if (route === null) return { flights: [], nearbyDates: [], inbound: null };

        const flights = (await prisma.flight.findMany({
            where: route,
            orderBy: { departureDate: 'asc' },
            include: flightRouteInclude,
        })).map(withRouteLabels);
        return { flights: flightsForCabin(flights, cabin), nearbyDates: [], inbound: null };
    }

    const now = new Date();

    // A round trip is two independent searches (#69), so they run together and
    // fail apart. The outbound is the trip: if it fails there is nothing to
    // show and the error stands. The return is a second dependency, and losing
    // it degrades the result rather than discarding the outbound too (#68).
    const [outboundResult, inboundResult] = await Promise.allSettled([
        searchOneDirection(from, to, departureDateStr, now, cabin),
        returnDateStr
            ? searchOneDirection(to, from, returnDateStr, now, cabin)
            : Promise.resolve(null),
    ]);

    if (outboundResult.status === 'rejected') throw outboundResult.reason;

    const inbound: InboundSearch | null = inboundResult.status === 'rejected'
        ? { status: 'unavailable' }
        : inboundResult.value === null
            ? null
            : { status: 'ok', ...inboundResult.value };

    return { ...outboundResult.value, inbound };
}

/**
 * The return leg of a round-trip search. Null for a one-way search, and
 * `unavailable` when that leg's search failed while the outbound succeeded --
 * which is a different thing from a return date with no flights on it.
 */
export type InboundSearch =
    | { status: 'ok'; flights: SearchResultFlight[]; nearbyDates: string[] }
    | { status: 'unavailable' };

const CABIN_ROW_COUNT: Record<CabinClass, (flight: Flight) => number | null> = {
    ECONOMY: flight => flight.economyRows,
    PREMIUM_ECONOMY: flight => flight.premiumEconomyRows,
    BUSINESS: flight => flight.businessRows,
    FIRST: flight => flight.firstClassRows,
};

/** A search result, and whether the cabin that was searched exists on it. */
export type SearchResultFlight = RoutedFlight & { cabinAvailable: boolean };

/**
 * Results annotated for one cabin: priced at its fare where it operates, and
 * marked where it does not.
 *
 * Flights without the cabin are kept rather than filtered out. Hiding them
 * would make a search for Business on a route with plenty of Economy seats
 * report no flights at all, which reads as "we do not fly there" instead of
 * "not in that cabin". They carry the fare that can actually be booked, so the
 * price shown is never one nobody will honour.
 *
 * A null row count is a flight predating per-cabin layouts; those fall back to
 * the same defaults the seat map uses, which is to assume the cabin exists.
 */
function flightsForCabin(flights: RoutedFlight[], cabin: CabinClass): SearchResultFlight[] {
    return flights.map(flight => {
        const available = (CABIN_ROW_COUNT[cabin](flight) ?? 1) > 0;
        if (!available || cabin === 'ECONOMY') {
            // Economy needs no arithmetic, and an unavailable cabin is quoted at
            // the catalogue fare because that is what the customer can book.
            return { ...flight, cabinAvailable: available };
        }
        // The fare is stored in one form, so quoting a cabin is arithmetic on a
        // number rather than a parse that can fail.
        return {
            ...flight,
            cabinAvailable: true,
            priceCents: calculatePassengerFareCents(flightFareCents(flight), cabin),
        };
    });
}

/**
 * Flights leaving `from` for `to` on one date, with nearby operating dates when
 * that date has none.
 *
 * Each direction of a round trip runs this separately, so the inbound is
 * searched on its own date and route rather than derived from the outbound.
 *
 * Read-only: inventory is generated ahead of demand by the seed and the
 * scheduler, so a customer request never writes (#71).
 */
async function searchOneDirection(
    from: string,
    to: string,
    isoDate: string,
    now: Date,
    cabin: CabinClass,
): Promise<{ flights: SearchResultFlight[]; nearbyDates: string[] }> {
    // The day the customer asked for, at the airport they are leaving from.
    // A UTC day is the wrong window once departures are instants: a 22:00 Miami
    // departure is 02:00Z the next day, and the route became unfindable on
    // every occurrence (#84).
    const { start: startOfDay, end: endOfDay } = airportDayBounds(isoDate, airportTimeZoneFor(from));
    // A flight that has already left today is not bookable, but one later today
    // still is.
    const departureLowerBound = startOfDay <= now
        ? { gt: now }
        : { gte: startOfDay };

    const route = flightRouteWhere(from, to);
    if (route === null) return { flights: [], nearbyDates: [] };

    const flights = flightsForCabin((await prisma.flight.findMany({
        where: {
            ...route,
            status: { not: 'CANCELLED' },
            departureDate: {
                ...departureLowerBound,
                // Half-open: `end` is midnight the next morning at the origin.
                lt: endOfDay
            }
        },
        orderBy: { departureDate: 'asc' },
        include: flightRouteInclude,
    })).map(withRouteLabels), cabin);

    if (flights.length > 0) return { flights, nearbyDates: [] };

    const originTimeZone = airportTimeZoneFor(from);
    const { earliestDate, latestDate } = bookingWindowIsoDates(now, originTimeZone);
    const [schedules, cancelledFlights] = await Promise.all([
        prisma.flightSchedule.findMany({
            where: {
                isActive: true,
                from,
                to,
            },
            select: {
                flightNumber: true,
                departureTime: true,
                daysOfWeek: true,
            },
        }),
        prisma.flight.findMany({
            where: {
                ...route,
                status: 'CANCELLED',
                departureDate: {
                    gte: airportDayBounds(earliestDate, airportTimeZoneFor(from)).start,
                    lt: airportDayBounds(latestDate, airportTimeZoneFor(from)).end,
                },
            },
            select: {
                flightNumber: true,
                departureDate: true,
            },
        }),
    ]);

    return {
        flights,
        nearbyDates: findNearbyOperatingDates(
            schedules,
            isoDate,
            now,
            cancelledFlights,
            originTimeZone,
        ),
    };
}

export async function getFlightRoutesAction() {
    const schedules = await prisma.flightSchedule.findMany({
        where: { isActive: true },
        select: {
            from: true,
            to: true,
            departureTime: true,
            daysOfWeek: true,
        },
        orderBy: [{ from: 'asc' }, { to: 'asc' }, { departureTime: 'asc' }],
    });

    return buildFlightRoutes(schedules);
}

export async function bookFlightAction(bookingData: {
    flightIds: number[];
    passengers: PassengerInput[];
    idempotencyKey: string;
}) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");
    const parsed = parseActionInput(bookingRequestSchema, bookingData);
    if (!parsed.ok) return parsed;
    bookingData = parsed.data as typeof bookingData;

    let result;
    try {
        result = await flightBookingService.bookFlight({
            flightIds: bookingData.flightIds,
            userId,
            passengers: bookingData.passengers,
            idempotencyKey: bookingData.idempotencyKey
        });
    } catch (error) {
        if (!(error instanceof SeatHoldUnavailableError)) throw error;

        const legIndex = bookingData.flightIds.indexOf(error.claim.flightId);
        const passengerIndex = bookingData.passengers.findIndex(
            passenger => passenger.seatNumbers[legIndex] === error.claim.seatNumber,
        );
        const field = legIndex >= 0 && passengerIndex >= 0
            ? `passengers.${passengerIndex}.seatNumbers.${legIndex}`
            : '_root';
        return actionValidationFailure(error.message, field);
    }

    try {
        // The confirmation names the outbound flight; a round trip's inbound
        // is shown on the itinerary rather than in the notification.
        const [outboundFlightId] = bookingData.flightIds;
        const flight = await prisma.flight.findUnique({
            where: { id: outboundFlightId },
            include: flightRouteInclude,
        });
        if (flight && result.wasCreated) {
            const points = Math.floor(bookingTotalCents(result, flight) / 100);
            await prisma.notification.create({
                data: {
                    userId,
                    title: `Booking Confirmed: ${flight.airline} ${flight.flightNumber}`,
                    message: `Successfully booked flight ${flight.flightNumber} from ${flight.fromAirport.label} to ${flight.toAirport.label}. Earned +${points} status points.`,
                    type: "POINTS"
                }
            });
        }
    } catch (err) {
        console.error("Failed to generate points notification:", err);
    }

    revalidatePath('/profile');
    return result;
}

/**
 * Which seats are taken on a flight, for the seat maps in checkout and in the
 * profile's seat change.
 *
 * Both of those routes are behind the middleware matcher, but a server action
 * is its own endpoint — the matcher guards page navigations and the action is
 * dispatched by header, so the route's protection is not this function's. It
 * was the only read here with neither a session check nor a public caller;
 * `searchFlightsAction` and `getFlightRoutesAction` are open because the
 * unauthenticated home page genuinely needs them (#154).
 *
 * Any signed-in traveller may ask about any flight. Narrowing it to flights the
 * caller has booked would refuse checkout, which needs the occupancy of a
 * flight before there is a booking to check against.
 */
export async function getOccupiedSeatsAction(flightId: number) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new Error("Unauthorized");

    flightId = parseInput(numericIdSchema, flightId);
    // Seats are held per leg. Reading Passenger.seatNumber answered with the
    // outbound seat whichever flight was asked about, so on a round trip it
    // reported a free seat as taken and the taken one as free.
    const assignments = await prisma.seatAssignment.findMany({
        where: heldSeats({ flightId }),
        select: {
            seatNumber: true
        }
    });

    // A seat another checkout is part-way through buying is unavailable too,
    // and for the customer's purposes indistinguishable from one already sold
    // (#74). This read has no checkout identity: the initial checkout page and
    // profile seat-change modal both use it, so every active hold counts.
    const beingChosen = await seatsOnHold(flightId);

    return [...new Set([...assignments.map(seat => seat.seatNumber), ...beingChosen])];
}

/**
 * Claim every seat the customer has chosen, for as long as it takes to pay.
 *
 * Called when they leave the seat map, not on each click. A hold per click
 * would have to follow every swap and deselection around the wizard, and the
 * window that actually matters is the one between choosing and paying.
 *
 * Reports which seats went rather than which succeeded: a customer who cannot
 * continue needs to know what to change, and "seat 12A has just been taken" is
 * the whole message. Seats claimed before the refusal stay claimed -- they are
 * the customer's, they expire on their own, and releasing them would hand away
 * seats over a problem with a different one.
 */
export async function holdChosenSeatsAction(request: {
    checkoutId: string;
    claims: { flightId: number; seatNumber: string }[];
}) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new Error("Unauthorized");

    const parsed = parseActionInput(checkoutSeatClaimsSchema, request);
    if (!parsed.ok) return parsed;

    const { checkoutId, claims: wanted } = parsed.data;
    const holderKey = checkoutHolderKey(session.user.id, checkoutId);

    const held = await holdSeats(wanted.map(claim => ({ ...claim, holderKey })));
    const taken = held.taken
        .map(({ flightId, seatNumber }) => ({ flightId, seatNumber }));

    // The leg travels with the seat. A round trip can carry 16A twice, and
    // reporting the number alone made the caller mark whichever leg it found
    // first -- so a customer who *had* been granted their outbound seat was
    // told it was gone while the leg that actually failed sat on another tab.
    if (taken.length > 0) return { ok: false as const, takenSeats: taken };
    if (!held.expiresAt) throw new Error('Held seats have no expiry.');

    return {
        ok: true as const,
        holdExpiresAt: held.expiresAt.toISOString(),
        holdExpiresInMilliseconds: held.expiresInMilliseconds,
    };
}

export async function toggleFavoriteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(favoriteSchema, { cityGuideId });
    if (!parsed.ok) return parsed;
    cityGuideId = parsed.data.cityGuideId;
    const existing = await prisma.userFavorite.findUnique({
        where: { userId_cityGuideId: { userId, cityGuideId } }
    });

    if (existing) {
        await prisma.userFavorite.delete({
            where: { id: existing.id }
        });
        return { isFavorite: false };
    } else {
        await prisma.userFavorite.create({
            data: { userId, cityGuideId }
        });
        return { isFavorite: true };
    }
}

export async function submitCityGuideReviewAction(cityGuideId: number, rating: number, content: string) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(reviewSchema, { cityGuideId, rating, content });
    if (!parsed.ok) return parsed;
    const validated = parsed.data;
    return await prisma.review.create({
        data: {
            userId,
            cityGuideId: validated.cityGuideId,
            rating: validated.rating,
            content: validated.content
        }
    });
}

const DEPARTED_MESSAGE =
    'This booking cannot be cancelled because the flight has already departed.';

/**
 * Thrown from inside the cancellation transaction so it rolls back, and turned
 * into the same refusal the early check gives. A policy answer rather than a
 * fault, but it has to unwind the transaction to be one.
 */
class BookingDepartedError extends Error {}

export async function cancelBookingAction(bookingId: number) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(numericIdSchema, bookingId);
    if (!parsed.ok) return parsed;
    bookingId = parsed.data;
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            legs: {
                include: {
                    flight: true,
                    // The cabin is held per traveller per leg, and the fee is a
                    // percentage of each traveller's own fare (#76).
                    seatAssignments: { select: { cabinClass: true } },
                },
                orderBy: { sequence: 'asc' },
            },
        }
    });
    if (!booking) throw new Error("Booking not found");

    if (!hasVerifiedStaffAccess(session) && booking.userId !== userId) {
        throw new Error("Unauthorized");
    }

    if (!cancellationOutcome(cancellableBooking(booking), new Date()).allowed) {
        // A refusal the customer can act on rather than a thrown error: this is
        // a policy answer, not a fault. Cancelling a flight that has departed
        // would free a seat that was used and take back the status points for a
        // trip they took (#76).
        return actionValidationFailure(DEPARTED_MESSAGE);
    }

    let updated;
    try {
        updated = await prisma.$transaction(async (tx) => {
        // Lock in ascending flight order, matching FlightBookingService. Leg
        // order would deadlock two itineraries that cover the same flights in
        // opposite directions.
        const lockOrder = bookingFlights(booking)
            .map(flight => flight.id)
            .sort((left, right) => left - right);
        for (const flightId of lockOrder) {
            await lockFlightForUpdate(tx, flightId);
        }
        // Re-read under the locks, and decide again from what is there now.
        //
        // The decision above was taken from an unlocked read, and staff can
        // cancel a flight in between -- which moves this booking to DISRUPTED
        // and makes it fully refundable. Deciding once, before the lock, would
        // charge the customer a fee for the airline's cancellation. The read
        // outside is what refuses early and cheaply; this is the one that
        // counts (#76).
        const lockedBooking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
                legs: {
                    include: {
                        flight: true,
                        seatAssignments: { select: { cabinClass: true } },
                    },
                    orderBy: { sequence: 'asc' },
                },
            },
        });
        if (!lockedBooking) throw new Error("Booking not found");
        if (lockedBooking.status === "CANCELLED") throw new Error("Booking is already cancelled");

        const settled = cancellationOutcome(cancellableBooking(lockedBooking), new Date());
        if (!settled.allowed) throw new BookingDepartedError();

        // What the cancellation owed back, recorded on the history row the
        // status change writes. Transaction-local, so it cannot leak onto the
        // next booking to use this connection, and set inside the same
        // transaction as the update or it would expire before the trigger read
        // it (#76). No money moves here: #75 owns that, and will have this
        // figure rather than re-deriving one from rules that may have moved.
        await tx.$executeRaw`SELECT set_config('app.booking_refund_cents', ${String(settled.refundCents)}, true)`;
        await tx.$executeRaw`SELECT set_config('app.booking_status_reason', ${cancellationNote(settled)}, true)`;

        // The seats are released by the status change below, not here: a
        // cancelled booking never holds one, so the database does it rather
        // than every caller that knows both facts. Releasing now sets
        // `releasedAt` and keeps the seat number, where the old code overwrote
        // the number with a placeholder and lost where the traveller sat (#76).
        return await tx.booking.update({
            where: { id: bookingId },
            data: { status: "CANCELLED" }
        });
        });
    } catch (error) {
        // The transaction rolls back, so nothing was cancelled and nothing
        // refunded; the customer gets the same answer as the early refusal.
        if (error instanceof BookingDepartedError) return actionValidationFailure(DEPARTED_MESSAGE);
        throw error;
    }

    try {
        const flight = outboundFlight(booking);
        if (flight && booking.userId) {
            const points = Math.floor(bookingTotalCents(booking, flight) / 100);
            await prisma.notification.create({
                data: {
                    userId: booking.userId,
                    title: `Booking Cancelled: ${flight.airline} ${flight.flightNumber}`,
                    message: `Booking for flight ${flight.flightNumber} has been cancelled. Deducted -${points} status points.`,
                    type: "POINTS"
                }
            });
        }
    } catch (err) {
        console.error("Failed to generate cancellation notification:", err);
    }

    revalidatePath('/profile');
    revalidatePath('/admin');
    return updated;
}

export async function changeBookingSeatsAction(
    bookingId: number,
    seatChanges: { passengerId: string, legId: number, seatNumber: string }[]
) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");
    const parsed = parseActionInput(seatChangesSchema, { bookingId, seatChanges });
    if (!parsed.ok) return parsed;
    bookingId = parsed.data.bookingId;
    seatChanges = parsed.data.seatChanges;

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            legs: {
                include: { flight: true },
                orderBy: { sequence: 'asc' },
            },
        }
    });
    if (!booking) throw new Error("Booking not found");

    if (!hasVerifiedStaffAccess(session) && booking.userId !== userId) {
        throw new Error("Unauthorized");
    }

    // A seat belongs to a leg, so each change names one. Legs are resolved from
    // the booking rather than trusted from the client: a leg id from another
    // booking would otherwise move a stranger's seat.
    const legsById = new Map(booking.legs.map(leg => [leg.id, leg]));

    // A seat on a flight the airline cancelled is not a seat to move. The
    // profile keeps "Change Seats" on a disrupted round trip because the other
    // leg may still be flown, so the guard has to be per leg and it has to be
    // here rather than in the component (#76).
    const grounded = seatChanges
        .map(change => legsById.get(change.legId))
        .filter(leg => leg?.flight?.status === 'CANCELLED');
    if (grounded.length > 0) {
        return actionValidationFailure(
            'That flight has been cancelled by the airline, so its seats cannot be changed. '
            + 'Cancel the booking for a full refund instead.'
        );
    }
    for (const change of seatChanges) {
        if (!legsById.has(change.legId)) {
            throw new Error(`Leg ${change.legId} does not belong to booking ${bookingId}`);
        }
    }

    // Lock in ascending flight id, matching FlightBookingService, so two
    // requests touching the same pair of flights cannot deadlock.
    const flightIds = [...new Set(
        seatChanges.map(change => legsById.get(change.legId)!.flightId)
    )].sort((left, right) => left - right);

    // Execute inside transaction to prevent concurrent seat collisions
    await prisma.$transaction(async (tx) => {
        for (const flightId of flightIds) {
            await lockFlightForUpdate(tx, flightId);
        }
        const lockedBooking = await tx.booking.findUnique({
            where: { id: bookingId },
            select: {
                status: true,
                passengers: { select: { id: true } },
            }
        });
        if (!lockedBooking) throw new Error("Booking not found");
        if (lockedBooking.status === "CANCELLED") {
            throw new Error("Seats cannot be changed on a cancelled booking");
        }

        // The cabin a seat has to fit is the one held on that leg, which is
        // recorded with the assignment. The traveller row used to carry a
        // single cabin describing the outbound, so a leg booked in a different
        // cabin was checked against the wrong one (#137).
        const heldCabins = new Map(
            (await tx.seatAssignment.findMany({
                where: { legId: { in: seatChanges.map(change => change.legId) } },
                select: { passengerId: true, legId: true, cabinClass: true },
            })).map(seat => [`${seat.legId}:${seat.passengerId}`, seat.cabinClass])
        );

        const lockedFlights = new Map(
            (await tx.flight.findMany({ where: { id: { in: flightIds } } }))
                .map(flight => [flight.id, flight])
        );
        if (lockedFlights.size !== flightIds.length) throw new Error("Flight not found");

        for (const change of seatChanges) {
            const passenger = lockedBooking.passengers.find(p => p.id === change.passengerId);
            if (!passenger) {
                throw new Error(`Passenger ${change.passengerId} does not belong to booking ${bookingId}`);
            }
            const cabinClass = heldCabins.get(`${change.legId}:${change.passengerId}`);
            if (!cabinClass) {
                throw new Error(`Passenger ${change.passengerId} holds no seat on leg ${change.legId}`);
            }
            const flightId = legsById.get(change.legId)!.flightId;
            assertSeatAvailableForCabin(change.seatNumber, cabinClass, lockedFlights.get(flightId)!);
        }

        // Occupancy comes from the seat assignments, which record a seat per
        // leg. Reading Passenger.seatNumber would report the outbound seat for
        // every leg of a round trip.
        const occupied = await tx.seatAssignment.findMany({
            where: heldSeats({
                flightId: { in: flightIds },
                NOT: { leg: { bookingId } },
            }),
            select: { flightId: true, seatNumber: true },
        });
        const occupiedSeats = new Set(occupied.map(seat => `${seat.flightId}:${seat.seatNumber}`));

        for (const change of seatChanges) {
            const flightId = legsById.get(change.legId)!.flightId;
            if (occupiedSeats.has(`${flightId}:${change.seatNumber}`)) {
                throw new Error(`Seat ${change.seatNumber} is already occupied by another passenger.`);
            }
        }

        // Apply changes. Scoped to the named leg: a passenger on a round trip
        // has an assignment per leg, so updating by passenger alone would
        // overwrite the seat they still hold on the other one.
        for (const change of seatChanges) {
            await tx.seatAssignment.updateMany({
                where: { passengerId: change.passengerId, legId: change.legId },
                data: { seatNumber: change.seatNumber }
            });
        }
    });

    revalidatePath('/profile');
    revalidatePath('/admin');
}

export async function deleteReviewAction(reviewId: string) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(stringIdSchema, reviewId);
    if (!parsed.ok) return parsed;
    reviewId = parsed.data;
    const review = await prisma.review.findUnique({
        where: { id: reviewId }
    });
    if (!review) throw new Error("Review not found");

    if (!hasVerifiedStaffAccess(session) && review.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const deleted = await prisma.review.delete({
        where: { id: reviewId }
    });
    revalidatePath('/travelguide');
    revalidatePath('/profile');
    return deleted;
}

const MAX_OCCURRENCE_RANGE_DAYS = 366;

export async function saveFlightScheduleAction(data: {
    id?: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureTime: string;
    /** Elapsed minutes gate to gate; the arrival time is derived from it (#84). */
    durationMinutes: number;
    daysOfWeek: number[];
    price: string;
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");
    const parsed = parseActionInput(scheduleSchema, data);
    if (!parsed.ok) return parsed;
    data = parsed.data as typeof data;

    // Server-side validation
    if (!data.flightNumber || !data.airline || !data.from || !data.to || !data.departureTime || !data.price) {
        throw new Error("Please fill in all required fields.");
    }

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(data.departureTime)) {
        throw new Error("Departure time must be in HH:MM format (24-hour).");
    }

    if (!Array.isArray(data.daysOfWeek) || data.daysOfWeek.length === 0) {
        throw new Error("Please select at least one day of the week.");
    }

    const firstClassRows = data.firstClassRows !== undefined && data.firstClassRows !== null ? Number(data.firstClassRows) : 3;
    const businessRows = data.businessRows !== undefined && data.businessRows !== null ? Number(data.businessRows) : 3;
    const premiumEconomyRows = data.premiumEconomyRows !== undefined && data.premiumEconomyRows !== null ? Number(data.premiumEconomyRows) : 4;
    const economyRows = data.economyRows !== undefined && data.economyRows !== null ? Number(data.economyRows) : 20;
    const seatPattern = data.seatPattern ?? "ABC-DEF";

    let normalizedSeatPattern: string;
    try {
        normalizedSeatPattern = validateSeatingLayout(
            firstClassRows,
            businessRows,
            premiumEconomyRows,
            economyRows,
            seatPattern
        );
    } catch (error) {
        return actionValidationFailure(
            error instanceof Error ? error.message : 'Seating layout is invalid.',
            'seatingConfig'
        );
    }

    // Before the schedule is written, not after.
    //
    // The occurrence loop below resolves these to airports, and a place that is
    // not an airport threw there — after the schedule had already been saved.
    // The administrator saw a generic failure for a save that had in fact
    // succeeded, because Next masks server-action messages in production. A
    // place someone typed is fixable input, so it is reported the way every
    // other fixable input in this action is.
    // Both ends, not the first bad one: returning early left the other field
    // looking valid and cost a second round trip to be told about it.
    const unknownPlaces: Record<string, string> = {};
    if (airportCodeFor(data.from) === null) {
        unknownPlaces.from = `No airport is known for "${data.from}". Use a place the airline flies from, such as "Seattle, USA".`;
    }
    if (airportCodeFor(data.to) === null) {
        unknownPlaces.to = `No airport is known for "${data.to}". Use a place the airline flies to, such as "Detroit, USA".`;
    }
    if (Object.keys(unknownPlaces).length > 0) {
        return actionValidationFailures(unknownPlaces);
    }

    let savedSchedule;
    if (data.id) {
        savedSchedule = await prisma.flightSchedule.update({
            where: { id: data.id },
            data: {
                flightNumber: data.flightNumber,
                airline: data.airline,
                from: data.from,
                to: data.to,
                departureTime: data.departureTime,
                durationMinutes: data.durationMinutes,
                daysOfWeek: data.daysOfWeek,
                priceCents: parsePriceToCents(data.price),
                firstClassRows,
                businessRows,
                premiumEconomyRows,
                economyRows,
                seatPattern: normalizedSeatPattern
            }
        });
    } else {
        savedSchedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: data.flightNumber,
                airline: data.airline,
                from: data.from,
                to: data.to,
                departureTime: data.departureTime,
                durationMinutes: data.durationMinutes,
                daysOfWeek: data.daysOfWeek,
                priceCents: parsePriceToCents(data.price),
                firstClassRows,
                businessRows,
                premiumEconomyRows,
                economyRows,
                seatPattern: normalizedSeatPattern
            }
        });
    }

    // Pre-generate flights for the next 30 days from this schedule
    const today = new Date();
    const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let i = 0; i < 30; i++) {
        const date = new Date(utcToday);
        date.setUTCDate(utcToday.getUTCDate() + i);
        const dayOfWeek = date.getUTCDay();

        if (savedSchedule.daysOfWeek.includes(dayOfWeek)) {
            const dateStr = date.toISOString().split('T')[0];
            const departureDate = departureInstantFor(dateStr, savedSchedule);
            
            // Check if flight instance already exists
            const existingInstance = await prisma.flight.findFirst({
                where: {
                    flightNumber: savedSchedule.flightNumber,
                    departureDate: departureDate
                }
            });

            if (!existingInstance) {
                try {
                    await prisma.flight.create({
                        data: {
                            flightNumber: savedSchedule.flightNumber,
                            airline: savedSchedule.airline,
                            ...airportCodesForRoute(savedSchedule.from, savedSchedule.to),
                            departureDate,
                            priceCents: savedSchedule.priceCents,
                            durationMinutes: savedSchedule.durationMinutes,
                            status: 'ON_TIME',
                            firstClassRows,
                            businessRows,
                            premiumEconomyRows,
                            economyRows,
                            seatPattern: normalizedSeatPattern
                        }
                    });
                } catch (error) {
                    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
                        throw error;
                    }
                }
            }
        }
    }

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');

    return savedSchedule;
}

export async function generateFlightOccurrencesAction(
    scheduleId: number,
    startDateStr: string,
    endDateStr: string,
    seatingConfig?: {
        firstClassRows?: number | null;
        businessRows?: number | null;
        premiumEconomyRows?: number | null;
        economyRows?: number | null;
        seatPattern?: string | null;
    }
) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");
    const parsed = parseActionInput(occurrenceRequestSchema, {
        scheduleId,
        startDate: startDateStr,
        endDate: endDateStr,
        seatingConfig
    });
    if (!parsed.ok) return parsed;
    scheduleId = parsed.data.scheduleId;
    startDateStr = parsed.data.startDate;
    endDateStr = parsed.data.endDate;
    seatingConfig = parsed.data.seatingConfig;

    const schedule = await prisma.flightSchedule.findUnique({
        where: { id: scheduleId }
    });
    if (!schedule) throw new Error("Flight schedule not found.");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
        throw new Error("Dates must use YYYY-MM-DD format.");
    }

    const start = new Date(`${startDateStr}T00:00:00Z`);
    const end = new Date(`${endDateStr}T00:00:00Z`);
    if (
        isNaN(start.getTime()) ||
        isNaN(end.getTime()) ||
        start.toISOString().slice(0, 10) !== startDateStr ||
        end.toISOString().slice(0, 10) !== endDateStr
    ) {
        throw new Error("Invalid start or end date.");
    }
    if (end < start) {
        throw new Error("End date must be on or after start date.");
    }
    const rangeDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (rangeDays > MAX_OCCURRENCE_RANGE_DAYS) {
        throw new Error(`Date range cannot exceed ${MAX_OCCURRENCE_RANGE_DAYS} days.`);
    }

    const firstClassRows = seatingConfig?.firstClassRows !== undefined && seatingConfig?.firstClassRows !== null ? Number(seatingConfig.firstClassRows) : (schedule.firstClassRows ?? 3);
    const businessRows = seatingConfig?.businessRows !== undefined && seatingConfig?.businessRows !== null ? Number(seatingConfig.businessRows) : (schedule.businessRows ?? 3);
    const premiumEconomyRows = seatingConfig?.premiumEconomyRows !== undefined && seatingConfig?.premiumEconomyRows !== null ? Number(seatingConfig.premiumEconomyRows) : (schedule.premiumEconomyRows ?? 4);
    const economyRows = seatingConfig?.economyRows !== undefined && seatingConfig?.economyRows !== null ? Number(seatingConfig.economyRows) : (schedule.economyRows ?? 20);
    const seatPattern = seatingConfig?.seatPattern !== undefined && seatingConfig.seatPattern !== null
        ? seatingConfig.seatPattern
        : (schedule.seatPattern ?? "ABC-DEF");

    let normalizedSeatPattern: string;
    try {
        normalizedSeatPattern = validateSeatingLayout(
            firstClassRows,
            businessRows,
            premiumEconomyRows,
            economyRows,
            seatPattern
        );
    } catch (error) {
        return actionValidationFailure(
            error instanceof Error ? error.message : 'Seating layout is invalid.',
            'seatingConfig'
        );
    }

    const current = new Date(start);
    let occurrencesCreated = 0;
    let occurrencesUpdated = 0;

    while (current <= end) {
        const dayOfWeek = current.getUTCDay();
        if (schedule.daysOfWeek.includes(dayOfWeek)) {
            const dateStr = current.toISOString().split('T')[0];
            const departureDate = departureInstantFor(dateStr, schedule);

            const existingInstance = await prisma.flight.findFirst({
                where: {
                    flightNumber: schedule.flightNumber,
                    departureDate: departureDate
                }
                // Only the id is used: updateFlightSeatingLayout does its own
                // check of the seats already held on the flight.
            });

            if (!existingInstance) {
                try {
                    await prisma.flight.create({
                        data: {
                            flightNumber: schedule.flightNumber,
                            airline: schedule.airline,
                            ...airportCodesForRoute(schedule.from, schedule.to),
                            departureDate,
                            priceCents: schedule.priceCents,
                            durationMinutes: schedule.durationMinutes,
                            status: 'ON_TIME',
                            firstClassRows,
                            businessRows,
                            premiumEconomyRows,
                            economyRows,
                            seatPattern: normalizedSeatPattern
                        }
                    });
                    occurrencesCreated++;
                } catch (error) {
                    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
                        throw error;
                    }
                    const concurrentInstance = await prisma.flight.findFirst({
                        where: {
                            flightNumber: schedule.flightNumber,
                            departureDate
                        }
                    });
                    if (!concurrentInstance) {
                        throw new Error('Concurrent occurrence creation could not be resolved.');
                    }
                    await updateFlightSeatingLayout(concurrentInstance.id, {
                        firstClassRows,
                        businessRows,
                        premiumEconomyRows,
                        economyRows,
                        seatPattern: normalizedSeatPattern
                    });
                    occurrencesUpdated++;
                }
            } else {
                await updateFlightSeatingLayout(existingInstance.id, {
                    firstClassRows,
                    businessRows,
                    premiumEconomyRows,
                    economyRows,
                    seatPattern: normalizedSeatPattern
                });
                occurrencesUpdated++;
            }
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');

    return {
        success: true,
        count: occurrencesCreated + occurrencesUpdated,
        created: occurrencesCreated,
        updated: occurrencesUpdated
    };
}

export async function deleteFlightScheduleAction(scheduleId: number) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsed = parseActionInput(numericIdSchema, scheduleId);
    if (!parsed.ok) return parsed;
    scheduleId = parsed.data;
    await prisma.flightSchedule.delete({
        where: { id: scheduleId }
    });

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');
}

export async function updateFlightStatusAction(flightId: number, status: 'ON_TIME' | 'DELAYED' | 'CANCELLED') {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsedId = parseActionInput(numericIdSchema, flightId);
    if (!parsedId.ok) return parsedId;
    const parsedStatus = parseActionInput(flightStatusSchema, status);
    if (!parsedStatus.ok) return parsedStatus;
    flightId = parsedId.data;
    status = parsedStatus.data;
    const actorId = session?.user?.id ?? null;

    // The status and what it does to the bookings move together, under the
    // flight's own lock. Cancelling a flight used to change only the flight:
    // the bookings stayed CONFIRMED, holding their seats, and the customer kept
    // a boarding pass for a flight that was not operating (#76).
    const { withAirports, outcomes } = await prisma.$transaction(async (tx) => {
        // No explicit flight lock: the update below takes the row's write lock
        // and holds it to commit, which is what a `SELECT ... FOR UPDATE` here
        // would have done a statement earlier. What needed locking was the
        // bookings, and that happens after (#76).
        const withAirports = await tx.flight.update({
            where: { id: flightId },
            data: { status },
            include: flightRouteInclude,
        });

        // Who is answerable for the change, on every history row it writes.
        if (actorId) {
            await tx.$executeRaw`SELECT set_config('app.booking_status_actor', ${actorId}, true)`;
        }
        await tx.$executeRaw`SELECT set_config('app.booking_status_reason', ${
            status === 'CANCELLED'
                ? `Flight ${withAirports.flightNumber} cancelled by the airline.`
                : `Flight ${withAirports.flightNumber} is operating again.`
        }, true)`;

        // Locked before anything is decided about them, because what each
        // booking should become depends on the other legs' flights -- rows this
        // transaction does not hold. See `lockBookingsOnFlightForUpdate`.
        const bookingIds = await lockBookingsOnFlightForUpdate(tx, flightId);

        const bookings = await tx.booking.findMany({
            where: { id: { in: bookingIds } },
            select: {
                id: true,
                status: true,
                userId: true,
                legs: { select: { flight: { select: { status: true } } } },
            },
        });

        // Decided per booking from what its own legs now say, rather than by a
        // predicate over rows that may be mid-change. One cancelled leg
        // disrupts the whole itinerary: half a trip is not a usable trip.
        const changed = bookings.filter(booking => {
            const grounded = booking.legs.some(leg => leg.flight?.status === 'CANCELLED');
            return booking.status !== (grounded ? 'DISRUPTED' : 'CONFIRMED');
        });

        for (const booking of changed) {
            const grounded = booking.legs.some(leg => leg.flight?.status === 'CANCELLED');
            await tx.booking.update({
                where: { id: booking.id },
                // DISRUPTED rather than CANCELLED: the customer keeps the
                // choice and keeps the seat while they decide, and a staff
                // misclick can be taken back.
                data: { status: grounded ? 'DISRUPTED' : 'CONFIRMED' },
            });
        }

        // Everyone holding a live booking on this flight hears about it --
        // a delay is the main thing this action announces, and only a
        // cancellation moves anybody's status. What each is told depends on
        // where their own trip ended up.
        // One message per person per outcome, not per booking: the text does
        // not name a booking, so two identical notices would just be noise.
        // Two bookings that ended differently do each earn a word.
        const outcomes = [...new Map(
            bookings
                .filter(booking => booking.userId)
                .map(booking => {
                    const stillGrounded = booking.legs.some(
                        leg => leg.flight?.status === 'CANCELLED',
                    );
                    return [
                        `${booking.userId}:${stillGrounded}`,
                        { userId: booking.userId as string, stillGrounded },
                    ] as const;
                }),
        ).values()];

        return { withAirports, outcomes };
    });

    // The relation objects would otherwise ride this return value across to
    // the client, which reads it only to check for a validation failure.
    const updated = withRouteLabels(withAirports);

    try {
        if (outcomes.length > 0) {
            const route = `${updated.flightNumber} from ${updated.from} to ${updated.to}`;
            await prisma.notification.createMany({
                data: outcomes.map(({ userId: targetUserId, stillGrounded }) => ({
                    userId: targetUserId,
                    title: `Flight Update: ${updated.airline} ${updated.flightNumber}`,
                    message: status === 'CANCELLED'
                        // Says what to do about it, because "cancelled" alone
                        // leaves the customer holding a booking with no
                        // obvious next step.
                        ? `Your flight ${route} has been cancelled by the airline. Your seat is held while you decide; cancel the booking from your profile for a full refund.`
                        : stillGrounded
                            // Their trip is still broken by another leg, so
                            // "is now ON TIME" would read as good news it is
                            // not.
                            ? `Your flight ${route} is operating again, but another flight in this booking is still cancelled.`
                            : `Your upcoming flight ${route} is now ${status.replace('_', ' ')}.`,
                    type: "FLIGHT_STATUS"
                }))
            });
        }
    } catch (err) {
        console.error("Failed to generate flight status notifications:", err);
    }

    revalidatePath('/flights');
    revalidatePath('/admin/flights');
    revalidatePath('/profile');
    revalidatePath('/admin');

    return updated;
}

export async function getUserNotificationsAction() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return [];

    return await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
    });
}

export async function markNotificationAsReadAction(id: string) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(stringIdSchema, id);
    if (!parsed.ok) return parsed;
    id = parsed.data;
    const notif = await prisma.notification.findUnique({
        where: { id }
    });
    if (!notif || notif.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const updated = await prisma.notification.update({
        where: { id },
        data: { isRead: true }
    });

    revalidatePath('/profile');
    return updated;
}

export async function markAllNotificationsAsReadAction() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const updated = await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true }
    });

    revalidatePath('/profile');
    return updated;
}
