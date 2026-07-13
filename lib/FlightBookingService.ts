import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { flightBookingServiceSchema, parseInput } from '@/lib/validation';

export interface PassengerInput {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | string;
  passportNumber: string;
  gender: string;
  seatNumber: string;
  cabinClass: string;
}

export default class FlightBookingService {
    async bookFlight(bookingData: { 
        flightId?: number; 
        userId?: string; 
        totalPrice?: string; 
        passengers: PassengerInput[];
        paymentIntentId?: string; 
    }) {
        const { flightId, userId, totalPrice, passengers, paymentIntentId } = parseInput(
            flightBookingServiceSchema,
            bookingData
        );

        // Run booking inside a database transaction to ensure atomic execution
        const savedBooking = await prisma.$transaction(async (tx) => {
            await lockFlightForUpdate(tx, flightId);
            const flight = await tx.flight.findUnique({ where: { id: flightId } });
            if (!flight) throw new Error("Flight not found");

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

            // Create booking with nested passengers
            return await tx.booking.create({
                data: {
                    flightId,
                    userId,
                    totalPrice: totalPrice || "$0",
                    paymentIntentId: paymentIntentId || `mock_tx_${Date.now()}`,
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
        });

        return savedBooking;
    }
}
