import { prisma } from '@/lib/prisma';

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
        passengers?: PassengerInput[]; 
        paymentIntentId?: string; 
    }) {
        const { flightId, userId, totalPrice, passengers, paymentIntentId } = bookingData;
        if (!flightId || !userId) {
            throw new Error("flightId and userId are required to book a flight.");
        }

        // Run booking inside a database transaction to ensure atomic execution
        const savedBooking = await prisma.$transaction(async (tx) => {
            // If passengers list is provided, validate seat numbers
            if (passengers && passengers.length > 0) {
                // Check if any seat is already booked on this flight
                const requestedSeats = passengers.map(p => p.seatNumber);
                
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
                                flightId // Pass flightId directly
                            }))
                        }
                    },
                    include: {
                        passengers: true
                    }
                });
            } else {
                // Fallback to simple booking for backward compatibility/legacy tests
                const flight = await tx.flight.findUnique({
                    where: { id: flightId }
                });
                return await tx.booking.create({
                    data: {
                        flightId,
                        userId,
                        totalPrice: flight?.price || "$0",
                        paymentIntentId: `mock_tx_${Date.now()}`
                    }
                });
            }
        });

        return savedBooking;
    }
}
