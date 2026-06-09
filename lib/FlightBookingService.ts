import { prisma } from '@/lib/prisma';

export default class FlightBookingService {
    async bookFlight(bookingData: { flightId?: number; userId?: string }) {
        // Booking is normalized: it references the Flight and User by id.
        // Flight details (number, route, price) live on the related Flight row.
        const savedBooking = await prisma.booking.create({
            data: {
                flightId: bookingData.flightId,
                userId: bookingData.userId,
            },
        });

        return savedBooking;
    }
}
