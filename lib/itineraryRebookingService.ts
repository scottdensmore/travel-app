import { lockBookingForUpdate, lockFlightForUpdate } from '@/lib/flightLock';
import { heldSeats } from '@/lib/seatOccupancy';
import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';

const REBOOKING_REASON = 'Rebooked after an airline cancellation.';

export type ItineraryRebookingErrorCode =
    | 'BOOKING_NOT_FOUND'
    | 'BOOKING_NOT_DISRUPTED'
    | 'REPLACEMENT_SET_INVALID'
    | 'REPLACEMENT_FLIGHT_INVALID'
    | 'SEAT_SELECTION_INVALID'
    | 'SEAT_UNAVAILABLE';

export class ItineraryRebookingError extends Error {
    constructor(
        readonly code: ItineraryRebookingErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ItineraryRebookingError';
    }
}

export interface RebookingSeatSelection {
    passengerId: string;
    seatNumber: string;
}

export interface RebookingLegSelection {
    fromLegId: number;
    replacementFlightId: number;
    seats: RebookingSeatSelection[];
}

export interface RebookItineraryInput {
    bookingId: number;
    replacements: RebookingLegSelection[];
    actorUserId?: string | null;
    /** When present, the locked booking must still belong to this customer. */
    ownerUserId?: string;
}

export interface RebookItineraryResult {
    bookingId: number;
    rebookingId: string;
    status: 'CONFIRMED';
    replacements: Array<{
        fromLegId: number;
        toLegId: number;
        replacementFlightId: number;
    }>;
}

function refusal(
    code: ItineraryRebookingErrorCode,
    message: string,
): ItineraryRebookingError {
    return new ItineraryRebookingError(code, message);
}

export class ItineraryRebookingService {
    async rebook(input: RebookItineraryInput): Promise<RebookItineraryResult> {
        const preflight = await prisma.booking.findUnique({
            where: { id: input.bookingId },
            select: {
                legs: {
                    where: { supersededAt: null },
                    select: { flightId: true },
                },
            },
        });
        if (!preflight) {
            throw refusal('BOOKING_NOT_FOUND', 'Booking not found.');
        }

        const lockOrder = [...new Set([
            ...preflight.legs.map(leg => leg.flightId),
            ...input.replacements.map(replacement => replacement.replacementFlightId),
        ])].sort((left, right) => left - right);

        return prisma.$transaction(async tx => {
            // Every seat writer in this application serialises on Flight. Keep
            // the same ascending order before taking the Booking lock so a
            // flight-status change and a rebooking cannot deadlock each other.
            for (const flightId of lockOrder) {
                await lockFlightForUpdate(tx, flightId);
            }
            await lockBookingForUpdate(tx, input.bookingId);

            // The preflight read exists only to discover locks. This read is
            // the decision: another staff/customer transaction may have
            // resolved the disruption while this one waited.
            const booking = await tx.booking.findUnique({
                where: { id: input.bookingId },
                include: {
                    passengers: { select: { id: true } },
                    legs: {
                        where: { supersededAt: null },
                        include: {
                            flight: true,
                            seatAssignments: {
                                where: heldSeats(),
                                select: {
                                    passengerId: true,
                                    cabinClass: true,
                                },
                            },
                        },
                        orderBy: { sequence: 'asc' },
                    },
                },
            });
            if (!booking) {
                throw refusal('BOOKING_NOT_FOUND', 'Booking not found.');
            }
            if (input.ownerUserId && booking.userId !== input.ownerUserId) {
                // Do not reveal whether another customer's booking ID exists.
                throw refusal('BOOKING_NOT_FOUND', 'Booking not found.');
            }
            if (booking.status !== 'DISRUPTED') {
                throw refusal(
                    'BOOKING_NOT_DISRUPTED',
                    'Only a disrupted booking can be rebooked.',
                );
            }

            const cancelledLegs = booking.legs.filter(leg => leg.flight.status === 'CANCELLED');
            const replacementsByLeg = new Map(
                input.replacements.map(replacement => [replacement.fromLegId, replacement]),
            );
            const requestedLegIds = new Set(input.replacements.map(({ fromLegId }) => fromLegId));
            const cancelledLegIds = new Set(cancelledLegs.map(leg => leg.id));
            if (
                input.replacements.length === 0
                || replacementsByLeg.size !== input.replacements.length
                || requestedLegIds.size !== cancelledLegIds.size
                || [...requestedLegIds].some(legId => !cancelledLegIds.has(legId))
            ) {
                throw refusal(
                    'REPLACEMENT_SET_INVALID',
                    'Every cancelled active leg must be replaced exactly once.',
                );
            }

            const replacementFlightIds = input.replacements
                .map(replacement => replacement.replacementFlightId);
            if (new Set(replacementFlightIds).size !== replacementFlightIds.length) {
                throw refusal(
                    'REPLACEMENT_SET_INVALID',
                    'Each replacement leg must use a distinct flight.',
                );
            }
            const replacementFlights = new Map((await tx.flight.findMany({
                where: { id: { in: replacementFlightIds } },
            })).map(flight => [flight.id, flight]));
            const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
                SELECT statement_timestamp() AS "now"
            `;
            if (!clock) throw new Error('Database clock was unavailable.');

            const passengerIds = new Set(booking.passengers.map(passenger => passenger.id));
            const prepared = input.replacements.map(replacement => {
                const fromLeg = cancelledLegs.find(leg => leg.id === replacement.fromLegId)!;
                const toFlight = replacementFlights.get(replacement.replacementFlightId);
                if (
                    !toFlight
                    || toFlight.status === 'CANCELLED'
                    || toFlight.departureDate <= clock.now
                    || toFlight.fromAirportCode !== fromLeg.flight.fromAirportCode
                    || toFlight.toAirportCode !== fromLeg.flight.toAirportCode
                ) {
                    throw refusal(
                        'REPLACEMENT_FLIGHT_INVALID',
                        'The replacement flight must be a future operating flight on the same route.',
                    );
                }

                const oldCabins = new Map(
                    fromLeg.seatAssignments.map(assignment => [
                        assignment.passengerId,
                        assignment.cabinClass,
                    ]),
                );
                const selectedPassengers = new Set(
                    replacement.seats.map(seat => seat.passengerId),
                );
                if (
                    replacement.seats.length !== passengerIds.size
                    || oldCabins.size !== passengerIds.size
                    || [...passengerIds].some(passengerId => !selectedPassengers.has(passengerId))
                ) {
                    throw refusal(
                        'SEAT_SELECTION_INVALID',
                        'Select one replacement seat for every passenger.',
                    );
                }

                const seats = replacement.seats.map(seat => {
                    const cabinClass = oldCabins.get(seat.passengerId)!;
                    try {
                        assertSeatAvailableForCabin(seat.seatNumber, cabinClass, toFlight);
                    } catch {
                        throw refusal(
                            'SEAT_SELECTION_INVALID',
                            `Seat ${seat.seatNumber} is not available in the passenger's booked cabin.`,
                        );
                    }
                    return { ...seat, cabinClass };
                });
                if (new Set(seats.map(seat => seat.seatNumber)).size !== seats.length) {
                    throw refusal(
                        'SEAT_SELECTION_INVALID',
                        'Each passenger needs a different seat on the replacement flight.',
                    );
                }
                return { replacement, fromLeg, toFlight, seats };
            });

            const [occupiedSeats, liveHolds] = await Promise.all([
                tx.seatAssignment.findMany({
                    where: heldSeats({ flightId: { in: replacementFlightIds } }),
                    select: { flightId: true, seatNumber: true },
                }),
                tx.seatHold.findMany({
                    where: {
                        flightId: { in: replacementFlightIds },
                        expiresAt: { gt: clock.now },
                    },
                    select: { flightId: true, seatNumber: true },
                }),
            ]);
            const unavailable = new Set([
                ...occupiedSeats.map(seat => `${seat.flightId}:${seat.seatNumber}`),
                ...liveHolds.map(seat => `${seat.flightId}:${seat.seatNumber}`),
            ]);
            if (prepared.some(item => item.seats.some(seat => (
                unavailable.has(`${item.toFlight.id}:${seat.seatNumber}`)
            )))) {
                throw refusal(
                    'SEAT_UNAVAILABLE',
                    'A selected replacement seat is no longer available.',
                );
            }

            const writtenReplacements: RebookItineraryResult['replacements'] = [];
            for (const item of prepared) {
                await tx.seatAssignment.updateMany({
                    where: heldSeats({
                        legId: item.fromLeg.id,
                    }),
                    data: { releasedAt: clock.now },
                });
                await tx.itineraryLeg.update({
                    where: { id: item.fromLeg.id },
                    data: { supersededAt: clock.now },
                });
                const toLeg = await tx.itineraryLeg.create({
                    data: {
                        bookingId: booking.id,
                        sequence: item.fromLeg.sequence,
                        flightId: item.toFlight.id,
                    },
                });
                await tx.seatAssignment.createMany({
                    data: item.seats.map(seat => ({
                        passengerId: seat.passengerId,
                        legId: toLeg.id,
                        flightId: item.toFlight.id,
                        seatNumber: seat.seatNumber,
                        cabinClass: seat.cabinClass,
                    })),
                });
                writtenReplacements.push({
                    fromLegId: item.fromLeg.id,
                    toLegId: toLeg.id,
                    replacementFlightId: item.toFlight.id,
                });
            }

            await tx.$executeRaw`
                SELECT set_config('app.booking_status_reason', ${REBOOKING_REASON}, true)
            `;
            await tx.$executeRaw`
                SELECT set_config(
                    'app.booking_status_actor',
                    ${input.actorUserId ?? ''},
                    true
                )
            `;
            await tx.booking.update({
                where: { id: booking.id },
                data: { status: 'CONFIRMED' },
            });
            const statusChange = await tx.bookingStatusChange.findFirstOrThrow({
                where: {
                    bookingId: booking.id,
                    from: 'DISRUPTED',
                    to: 'CONFIRMED',
                },
                orderBy: { sequence: 'desc' },
            });
            const rebooking = await tx.bookingRebooking.create({
                data: {
                    bookingId: booking.id,
                    bookingStatusChangeId: statusChange.id,
                    farePolicy: 'DISRUPTION_WAIVER',
                },
            });
            await tx.bookingRebookingLeg.createMany({
                data: writtenReplacements.map(replacement => ({
                    rebookingId: rebooking.id,
                    fromLegId: replacement.fromLegId,
                    toLegId: replacement.toLegId,
                })),
            });

            // Prisma 5 can resolve an interactive transaction even when a
            // deferred trigger rejects COMMIT. Surface every integrity failure
            // to this caller before the transaction callback returns.
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;

            return {
                bookingId: booking.id,
                rebookingId: rebooking.id,
                status: 'CONFIRMED' as const,
                replacements: writtenReplacements,
            };
        });
    }
}
