import { prisma } from '@/lib/prisma';

export default class FlightBookingService {
    async bookFlight(bookingData: {
        flightNumber?: string;
        airline?: string;
        from?: string;
        to?: string;
        departureDate?: Date;
        returnDate?: Date | null;
        price?: string;
        userId?: string;
        flightId?: number;
    }) {
        const savedBooking = await prisma.booking.create({
            data: {
                flightNumber: bookingData.flightNumber || '',
                airline: bookingData.airline || '',
                from: bookingData.from || '',
                to: bookingData.to || '',
                departureDate: bookingData.departureDate || new Date(),
                returnDate: bookingData.returnDate,
                price: bookingData.price || '',
                userId: bookingData.userId,
                flightId: bookingData.flightId,
            }
        });

        return savedBooking;
    }
}

