import { randomUUID } from 'node:crypto';
import { heldSeats } from '@/lib/seatOccupancy';
import { bookingFlights } from '@/lib/bookingItinerary';
import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { flightBookingServiceSchema, parseInput } from '@/lib/validation';
import { calculateItineraryTotal, flightFareCents } from '@/lib/bookingPricing';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import {
    decryptPassengerData,
    encryptPassengerData,
    getPassengerDataRetentionDeadline,
} from '@/lib/passengerDataProtection';

export interface PassengerInput {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | string;
  passportNumber: string;
  gender: string;
  /// One seat per leg, in itinerary order.
  seatNumbers: string[];
  cabinClass: string;
}

function passengerRequestSignature(passenger: PassengerInput): string {
    const dateOfBirth = passenger.dateOfBirth instanceof Date
        ? passenger.dateOfBirth.toISOString().slice(0, 10)
        : passenger.dateOfBirth.slice(0, 10);
    return JSON.stringify([
        passenger.firstName,
        passenger.lastName,
        dateOfBirth,
        passenger.passportNumber,
        passenger.gender,
        passenger.seatNumbers,
        passenger.cabinClass
    ]);
}

interface ProtectedPassenger extends Omit<PassengerInput, 'dateOfBirth' | 'passportNumber' | 'seatNumbers' | 'cabinClass'> {
    id: string;
    dateOfBirthEncrypted: string | null;
    passportNumberEncrypted: string | null;
    seatAssignments?: Array<{
        seatNumber: string;
        cabinClass: string;
        leg: { sequence: number };
    }>;
}

/** A traveller's seats in leg order, which is how a booking reports them. */
function seatNumbersInLegOrder(
    passenger: { seatAssignments?: Array<{ seatNumber: string; leg: { sequence: number } }> }
): string[] {
    return [...(passenger.seatAssignments ?? [])]
        .sort((left, right) => left.leg.sequence - right.leg.sequence)
        .map(assignment => assignment.seatNumber);
}

function protectedPassengerRequestSignature(passenger: ProtectedPassenger): string {
    if (!passenger.dateOfBirthEncrypted || !passenger.passportNumberEncrypted) {
        throw new Error('Passenger identity data is no longer available.');
    }
    // Seats come from the assignments, in leg order, so a retry with a
    // different return seat is a different request.
    const seatNumbers = seatNumbersInLegOrder(passenger);

    return passengerRequestSignature({
        ...passenger,
        seatNumbers,
        // The cabin is recorded per leg; a booking holds one cabin, so the
        // first assignment answers for the request.
        cabinClass: passenger.seatAssignments?.[0]?.cabinClass ?? 'ECONOMY',
        dateOfBirth: decryptPassengerData(passenger.dateOfBirthEncrypted, {
            passengerId: passenger.id,
            field: 'dateOfBirth',
        }),
        passportNumber: decryptPassengerData(passenger.passportNumberEncrypted, {
            passengerId: passenger.id,
            field: 'passportNumber',
        }),
    });
}

function matchesPersistedRequest(
    existingFlightIds: number[],
    existingPassengers: ProtectedPassenger[],
    flightIds: number[],
    passengers: PassengerInput[]
): boolean {
    const sameItinerary = existingFlightIds.length === flightIds.length
        && existingFlightIds.every((id, index) => id === flightIds[index]);
    if (!sameItinerary || existingPassengers.length !== passengers.length) {
        return false;
    }
    const existingSignatures = existingPassengers.map(protectedPassengerRequestSignature).sort();
    const requestedSignatures = passengers.map(passengerRequestSignature).sort();
    return existingSignatures.every((signature, index) => signature === requestedSignatures[index]);
}

export default class FlightBookingService {
    async bookFlight(bookingData: {
        flightIds: number[];
        userId: string;
        passengers: PassengerInput[];
        idempotencyKey: string;
    }) {
        const { flightIds, userId, passengers, idempotencyKey } = parseInput(
            flightBookingServiceSchema,
            bookingData
        );

        // Run booking inside a database transaction to ensure atomic execution
        const savedBooking = await prisma.$transaction(async (tx) => {
            // Lock in ascending flight order rather than itinerary order. Two
            // itineraries covering the same flights in opposite directions would
            // otherwise deadlock against each other.
            for (const id of [...flightIds].sort((left, right) => left - right)) {
                await lockFlightForUpdate(tx, id);
            }

            const flightsById = new Map(
                (await tx.flight.findMany({ where: { id: { in: flightIds } } }))
                    .map(flight => [flight.id, flight])
            );
            const flights = flightIds.map(id => {
                const flight = flightsById.get(id);
                if (!flight) throw new Error("Flight not found");
                return flight;
            });

            const existingRequest = await tx.booking.findFirst({
                where: { userId, idempotencyKey },
                include: {
                    legs: {
                        include: { flight: true },
                        orderBy: { sequence: 'asc' },
                    },
                    passengers: {
                        select: {
                            ...safePassengerSelect,
                            dateOfBirthEncrypted: true,
                            passportNumberEncrypted: true,
                            seatAssignments: {
                                select: {
                                    seatNumber: true,
                                    cabinClass: true,
                                    leg: { select: { sequence: true } },
                                },
                            },
                        }
                    }
                }
            });
            if (existingRequest) {
                if (!matchesPersistedRequest(
                    bookingFlights(existingRequest).map(flight => flight.id),
                    existingRequest.passengers,
                    flightIds,
                    passengers
                )) {
                    throw new Error('Booking request ID was already used for a different booking.');
                }
                return {
                    ...existingRequest,
                    // Seats come from the assignments, which carry one per leg;
                    // the traveller record no longer holds a seat at all (#137).
                    passengers: existingRequest.passengers.map(passenger => ({
                        id: passenger.id,
                        firstName: passenger.firstName,
                        lastName: passenger.lastName,
                        gender: passenger.gender,
                        seatNumbers: seatNumbersInLegOrder(passenger),
                        // The cabin travels with the seat, so a caller never has
                        // to pair this row back up with its own request.
                        cabinClass: passenger.seatAssignments?.[0]?.cabinClass ?? 'ECONOMY',
                    })),
                    wasCreated: false,
                };
            }

            // Each leg is checked against its own flight: a seat that exists in
            // one cabin layout may not exist in the other, and occupancy is per
            // flight.
            for (const [legIndex, flight] of flights.entries()) {
                if (flight.status === 'CANCELLED' || flight.departureDate.getTime() <= Date.now()) {
                    throw new Error('Flight is not available for booking.');
                }

                const requestedSeats = passengers.map(passenger => passenger.seatNumbers[legIndex]);
                if (new Set(requestedSeats).size !== requestedSeats.length) {
                    throw new Error("Duplicate seats selected in request.");
                }

                for (const passenger of passengers) {
                    assertSeatAvailableForCabin(
                        passenger.seatNumbers[legIndex],
                        passenger.cabinClass,
                        flight
                    );
                }

                // Occupancy comes from the seat assignments rather than from
                // Passenger, which can only describe one leg.
                const occupied = new Set(
                    (await tx.seatAssignment.findMany({
                        where: heldSeats({ flightId: flight.id }),
                        select: { seatNumber: true },
                    })).map(assignment => assignment.seatNumber)
                );

                for (const seat of requestedSeats) {
                    if (occupied.has(seat)) {
                        throw new Error(`Seat ${seat} is already occupied on this flight.`);
                    }
                }
            }

            const total = calculateItineraryTotal(
                flights.map(flightFareCents),
                passengers.map(passenger => ({
                    // `passengers` here is the parsed request, so this is
                    // already one of the four — but `PassengerInput` still
                    // declares `string`, and narrowing that is a chain through
                    // the local Prisma-shaped types and fourteen fixtures
                    // (#183).
                    cabinClass: passenger.cabinClass as 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
                }))
            );

            // Retain passenger data until the trip ends, which is the last leg.
            const lastDeparture = flights
                .map(flight => flight.departureDate)
                .reduce((latest, date) => (date > latest ? date : latest));
            const sensitiveDataExpiresAt = getPassengerDataRetentionDeadline(lastDeparture);

            const protectedPassengers = passengers.map(passenger => {
                const id = randomUUID();
                const dateOfBirth = passenger.dateOfBirth.slice(0, 10);
                return {
                    id,
                    firstName: passenger.firstName,
                    lastName: passenger.lastName,
                    dateOfBirthEncrypted: encryptPassengerData(dateOfBirth, {
                        passengerId: id,
                        field: 'dateOfBirth',
                    }),
                    passportNumberEncrypted: encryptPassengerData(passenger.passportNumber, {
                        passengerId: id,
                        field: 'passportNumber',
                    }),
                    sensitiveDataExpiresAt,
                    gender: passenger.gender,
                    // A traveller is a person, not a seat. Where they sit is a
                    // SeatAssignment per leg, written below (#137).
                };
            });

            const booking = await tx.booking.create({
                data: {
                    userId,
                    totalPriceCents: total.cents,
                    legs: {
                        create: flightIds.map((flightId, index) => ({
                            sequence: index + 1,
                            flightId,
                        })),
                    },
                    paymentIntentId: null,
                    idempotencyKey,
                    passengers: {
                        create: protectedPassengers
                    }
                },
                include: {
                    passengers: { select: safePassengerSelect },
                    legs: { orderBy: { sequence: 'asc' } }
                }
            });

            // Seat assignments need each leg's identity, so they follow the
            // booking. Written from the same arrays the legs and passengers came
            // from, so the three cannot disagree.
            await tx.seatAssignment.createMany({
                data: booking.legs.flatMap((leg, legIndex) => (
                    protectedPassengers.map((passenger, passengerIndex) => ({
                        passengerId: passenger.id,
                        legId: leg.id,
                        flightId: leg.flightId,
                        seatNumber: passengers[passengerIndex].seatNumbers[legIndex],
                        // The cabin belongs to the seat, and the request is
                        // what says which cabin was bought.
                        cabinClass: passengers[passengerIndex].cabinClass,
                    }))
                )),
            });

            // What each traveller bought, keyed by the id we minted for them.
            // protectedPassengers is built from passengers in order, so the two
            // line up here by construction -- but the created rows come back
            // from an unordered relation, so they are matched by identity below
            // rather than by position.
            const purchasedByPassengerId = new Map<string, PassengerInput>(protectedPassengers.map(
                (protectedPassenger, index) => [protectedPassenger.id, passengers[index]]
            ));

            return {
                ...booking,
                // From the request, not from the include: the assignments are
                // written after the booking, so the loaded relation is empty
                // here and a confirmation would print no seat at all.
                passengers: booking.passengers.map(passenger => {
                    const purchased = purchasedByPassengerId.get(passenger.id);
                    return {
                        id: passenger.id,
                        firstName: passenger.firstName,
                        lastName: passenger.lastName,
                        gender: passenger.gender,
                        seatNumbers: purchased?.seatNumbers ?? [],
                        cabinClass: purchased?.cabinClass ?? 'ECONOMY',
                    };
                }),
                wasCreated: true,
            };
        });

        return savedBooking;
    }
}
