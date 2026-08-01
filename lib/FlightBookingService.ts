import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { flightBookingServiceSchema, parseInput } from '@/lib/validation';
import { calculateBookingTotal } from '@/lib/bookingPricing';
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
  seatNumber: string;
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
        passenger.seatNumber,
        passenger.cabinClass
    ]);
}

interface ProtectedPassenger extends Omit<PassengerInput, 'dateOfBirth' | 'passportNumber'> {
    id: string;
    dateOfBirthEncrypted: string | null;
    passportNumberEncrypted: string | null;
}

function protectedPassengerRequestSignature(passenger: ProtectedPassenger): string {
    if (!passenger.dateOfBirthEncrypted || !passenger.passportNumberEncrypted) {
        throw new Error('Passenger identity data is no longer available.');
    }
    return passengerRequestSignature({
        ...passenger,
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
    existingFlightId: number | null,
    existingPassengers: ProtectedPassenger[],
    flightId: number,
    passengers: PassengerInput[]
): boolean {
    if (existingFlightId !== flightId || existingPassengers.length !== passengers.length) {
        return false;
    }
    const existingSignatures = existingPassengers.map(protectedPassengerRequestSignature).sort();
    const requestedSignatures = passengers.map(passengerRequestSignature).sort();
    return existingSignatures.every((signature, index) => signature === requestedSignatures[index]);
}

export default class FlightBookingService {
    async bookFlight(bookingData: { 
        flightId: number;
        userId: string;
        passengers: PassengerInput[];
        idempotencyKey: string;
    }) {
        const { flightId, userId, passengers, idempotencyKey } = parseInput(
            flightBookingServiceSchema,
            bookingData
        );

        // Run booking inside a database transaction to ensure atomic execution
        const savedBooking = await prisma.$transaction(async (tx) => {
            await lockFlightForUpdate(tx, flightId);
            const flight = await tx.flight.findUnique({ where: { id: flightId } });
            if (!flight) throw new Error("Flight not found");

            const existingRequest = await tx.booking.findFirst({
                where: { userId, idempotencyKey },
                include: {
                    passengers: {
                        select: {
                            ...safePassengerSelect,
                            dateOfBirthEncrypted: true,
                            passportNumberEncrypted: true,
                        }
                    }
                }
            });
            if (existingRequest) {
                if (!matchesPersistedRequest(
                    existingRequest.flightId,
                    existingRequest.passengers,
                    flightId,
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

            if (flight.status === 'CANCELLED' || flight.departureDate.getTime() <= Date.now()) {
                throw new Error('Flight is not available for booking.');
            }

            // Check if any seat is already booked on this flight
            const requestedSeats = passengers.map(p => p.seatNumber);
            if (new Set(requestedSeats).size !== requestedSeats.length) {
                throw new Error("Duplicate seats selected in request.");
            }

            for (const passenger of passengers) {
                assertSeatAvailableForCabin(
                    passenger.seatNumber,
                    passenger.cabinClass,
                    flight
                );
            }

            const existingBookings = await tx.booking.findMany({
                where: { flightId, status: { not: "CANCELLED" } },
                include: { passengers: { select: { seatNumber: true } } }
            });

            const occupiedSeats = new Set(
                existingBookings
                    .flatMap(b => b.passengers)
                    .map(p => p.seatNumber)
            );

            for (const seat of requestedSeats) {
                if (occupiedSeats.has(seat)) {
                    throw new Error(`Seat ${seat} is already occupied on this flight.`);
                }
            }

            const total = calculateBookingTotal(
                flight.price,
                passengers.map(passenger => ({
                    cabinClass: passenger.cabinClass as 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
                }))
            );

            const sensitiveDataExpiresAt = getPassengerDataRetentionDeadline(flight.departureDate);
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
                    seatNumber: passenger.seatNumber,
                    cabinClass: passenger.cabinClass,
                    flightId,
                };
            });

            // Create booking with nested passengers
            const booking = await tx.booking.create({
                data: {
                    flightId,
                    userId,
                    // totalPrice is retained for one release so a rollback keeps
                    // a displayable value; totalPriceCents is the source of truth.
                    totalPrice: total.formatted,
                    totalPriceCents: total.cents,
                    paymentIntentId: null,
                    idempotencyKey,
                    passengers: {
                        create: protectedPassengers
                    }
                },
                include: {
                    passengers: { select: safePassengerSelect }
                }
            });
            return { ...booking, wasCreated: true };
        });

        return savedBooking;
    }
}
