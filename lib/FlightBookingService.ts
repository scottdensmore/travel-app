import { randomUUID } from 'node:crypto';
import { bookingFlights } from '@/lib/bookingItinerary';
import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { flightBookingServiceSchema, parseInput } from '@/lib/validation';
import { calculateItineraryTotal } from '@/lib/bookingPricing';
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

interface ProtectedPassenger extends Omit<PassengerInput, 'dateOfBirth' | 'passportNumber' | 'seatNumbers'> {
    id: string;
    dateOfBirthEncrypted: string | null;
    passportNumberEncrypted: string | null;
    seatAssignments?: Array<{ seatNumber: string; leg: { sequence: number } }>;
}

function protectedPassengerRequestSignature(passenger: ProtectedPassenger): string {
    if (!passenger.dateOfBirthEncrypted || !passenger.passportNumberEncrypted) {
        throw new Error('Passenger identity data is no longer available.');
    }
    // Seats come from the assignments, in leg order. Passenger carries only the
    // outbound seat, so comparing that alone would treat a retry with a
    // different return seat as the same request.
    const seatNumbers = [...(passenger.seatAssignments ?? [])]
        .sort((left, right) => left.leg.sequence - right.leg.sequence)
        .map(assignment => assignment.seatNumber);

    return passengerRequestSignature({
        ...passenger,
        seatNumbers,
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
                    passengers: existingRequest.passengers.map(passenger => ({
                        id: passenger.id,
                        firstName: passenger.firstName,
                        lastName: passenger.lastName,
                        gender: passenger.gender,
                        seatNumber: passenger.seatNumber,
                        cabinClass: passenger.cabinClass,
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
                        where: {
                            flightId: flight.id,
                            leg: { booking: { status: { not: "CANCELLED" } } },
                        },
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
                flights.map(flight => flight.price),
                passengers.map(passenger => ({
                    cabinClass: passenger.cabinClass as 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
                }))
            );

            // Retain passenger data until the trip ends, which is the last leg.
            const lastDeparture = flights
                .map(flight => flight.departureDate)
                .reduce((latest, date) => (date > latest ? date : latest));
            const sensitiveDataExpiresAt = getPassengerDataRetentionDeadline(lastDeparture);

            const [outboundFlightId] = flightIds;
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
                    // Passenger still carries one seat and one flight while those
                    // columns are being retired; they describe the outbound leg.
                    seatNumber: passenger.seatNumbers[0],
                    cabinClass: passenger.cabinClass,
                    flightId: outboundFlightId,
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
                        cabinClass: passenger.cabinClass,
                    }))
                )),
            });

            return { ...booking, wasCreated: true };
        });

        return savedBooking;
    }
}
