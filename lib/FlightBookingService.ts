import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { flightBookingServiceSchema, parseInput } from '@/lib/validation';
import { calculateBookingTotal } from '@/lib/bookingPricing';

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

function matchesPersistedRequest(
    existingFlightId: number | null,
    existingPassengers: PassengerInput[],
    flightId: number,
    passengers: PassengerInput[]
): boolean {
    if (existingFlightId !== flightId || existingPassengers.length !== passengers.length) {
        return false;
    }
    const existingSignatures = existingPassengers.map(passengerRequestSignature).sort();
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
                include: { passengers: true }
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
                return { ...existingRequest, wasCreated: false };
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
                include: { passengers: true }
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

            // Create booking with nested passengers
            const booking = await tx.booking.create({
                data: {
                    flightId,
                    userId,
                    totalPrice: total.formatted,
                    paymentIntentId: null,
                    idempotencyKey,
                    passengers: {
                        create: passengers.map(p => ({
                            firstName: p.firstName,
                            lastName: p.lastName,
                            dateOfBirth: new Date(p.dateOfBirth),
                            passportNumber: p.passportNumber,
                            gender: p.gender,
                            seatNumber: p.seatNumber,
                            cabinClass: p.cabinClass,
                            flightId
                        }))
                    }
                },
                include: {
                    passengers: true
                }
            });
            return { ...booking, wasCreated: true };
        });

        return savedBooking;
    }
}
