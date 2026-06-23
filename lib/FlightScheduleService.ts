import { prisma } from './prisma';

export default class FlightScheduleService {
    async generateFlightsForDate(date: Date) {
        // Use getUTCDay() to avoid local timezone shifting
        const dayOfWeek = date.getUTCDay(); 
        
        // Find active schedules that run on this day of the week
        const schedules = await prisma.flightSchedule.findMany({
            where: {
                isActive: true,
                daysOfWeek: {
                    has: dayOfWeek
                }
            }
        });

        const generatedFlights = [];

        for (const schedule of schedules) {
            const dateStr = date.toISOString().split('T')[0];
            const departureDate = new Date(`${dateStr}T${schedule.departureTime}:00Z`);
            
            let returnDate = null;
            if (schedule.returnTime) {
                const retDate = new Date(date);
                // Use UTC methods for return leg date calculations
                retDate.setUTCDate(date.getUTCDate() + 7);
                const retDateStr = retDate.toISOString().split('T')[0];
                returnDate = new Date(`${retDateStr}T${schedule.returnTime}:00Z`);
            }

            // Check if flight instance already exists
            let flight = await prisma.flight.findFirst({
                where: {
                    flightNumber: schedule.flightNumber,
                    departureDate: departureDate
                }
            });

            if (!flight) {
                try {
                    flight = await prisma.flight.create({
                        data: {
                            flightNumber: schedule.flightNumber,
                            airline: schedule.airline,
                            from: schedule.from,
                            to: schedule.to,
                            departureDate,
                            returnDate,
                            price: schedule.price,
                            status: 'ON_TIME'
                        }
                    });
                } catch (error) {
                    // Gracefully handle concurrent insertion race condition (Prisma unique constraint error P2002)
                    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
                        flight = await prisma.flight.findFirst({
                            where: {
                                flightNumber: schedule.flightNumber,
                                departureDate: departureDate
                            }
                        });
                    } else {
                        throw error;
                    }
                }
            }

            if (flight) {
                generatedFlights.push(flight);
            }
        }

        return generatedFlights;
    }
}
