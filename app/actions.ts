'use server'

import { revalidatePath } from 'next/cache';
import TravelGuideService from '@/lib/TravelGuideService';
import FlightBookingService, { PassengerInput } from '@/lib/FlightBookingService';
import FlightScheduleService from '@/lib/FlightScheduleService';
import CityGuide from '@/lib/types/CityGuide';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const travelGuideService = new TravelGuideService();
const flightBookingService = new FlightBookingService();

export async function saveCityGuideAction(cityGuide: CityGuide) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') throw new Error("Unauthorized");

    const result = await travelGuideService.saveCityGuide(cityGuide);
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
    return result;
}

export async function deleteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') throw new Error("Unauthorized");

    await prisma.cityGuide.delete({
        where: { id: cityGuideId }
    });
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
}

export async function searchFlightsAction(from: string, to: string, departureDateStr?: string) {
    if (!departureDateStr) {
        return await prisma.flight.findMany({
            where: { from, to },
            orderBy: { departureDate: 'asc' },
        });
    }

    const searchDate = new Date(departureDateStr);
    const scheduleService = new FlightScheduleService();
    await scheduleService.generateFlightsForDate(searchDate);

    const dateStr = searchDate.toISOString().split('T')[0];
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    return await prisma.flight.findMany({
        where: {
            from,
            to,
            departureDate: {
                gte: startOfDay,
                lte: endOfDay
            }
        },
        orderBy: { departureDate: 'asc' },
    });
}

export async function getFlightRoutesAction() {
    // Distinct origin/destination pairs that actually have flight schedules, so the
    // booking form can offer only reachable routes.
    return await prisma.flightSchedule.findMany({
        distinct: ['from', 'to'],
        select: { from: true, to: true },
        orderBy: [{ from: 'asc' }, { to: 'asc' }],
    });
}

export async function bookFlightAction(bookingData: { 
    flightId: number; 
    totalPrice?: string; 
    passengers?: PassengerInput[]; 
    paymentIntentId?: string; 
}) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const result = await flightBookingService.bookFlight({
        flightId: bookingData.flightId,
        userId,
        totalPrice: bookingData.totalPrice,
        passengers: bookingData.passengers,
        paymentIntentId: bookingData.paymentIntentId
    });
    revalidatePath('/profile');
    return result;
}

export async function getOccupiedSeatsAction(flightId: number) {
    const passengers = await prisma.passenger.findMany({
        where: {
            booking: {
                flightId,
                status: { not: "CANCELLED" }
            }
        },
        select: {
            seatNumber: true
        }
    });
    return passengers.map(p => p.seatNumber);
}

export async function toggleFavoriteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const existing = await prisma.userFavorite.findUnique({
        where: { userId_cityGuideId: { userId, cityGuideId } }
    });

    if (existing) {
        await prisma.userFavorite.delete({
            where: { id: existing.id }
        });
        return { isFavorite: false };
    } else {
        await prisma.userFavorite.create({
            data: { userId, cityGuideId }
        });
        return { isFavorite: true };
    }
}

export async function submitCityGuideReviewAction(cityGuideId: number, rating: number, content: string) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    return await prisma.review.create({
        data: {
            userId,
            cityGuideId,
            rating,
            content
        }
    });
}

export async function cancelBookingAction(bookingId: number) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId }
    });
    if (!booking) throw new Error("Booking not found");

    if (session.user.role !== 'ADMIN' && booking.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const updated = await prisma.$transaction(async (tx) => {
        const passengers = await tx.passenger.findMany({
            where: { bookingId }
        });
        
        for (const passenger of passengers) {
            await tx.passenger.update({
                where: { id: passenger.id },
                data: { seatNumber: `CANCELLED-${passenger.id}` }
            });
        }

        return await tx.booking.update({
            where: { id: bookingId },
            data: { status: "CANCELLED" }
        });
    });
    revalidatePath('/profile');
    revalidatePath('/admin');
    return updated;
}

export async function changeBookingSeatsAction(
    bookingId: number,
    seatChanges: { passengerId: string, seatNumber: string }[]
) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { passengers: true }
    });
    if (!booking) throw new Error("Booking not found");

    if (session.user.role !== 'ADMIN' && booking.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const flightId = booking.flightId;
    if (!flightId) throw new Error("Flight not found on booking");

    // Execute inside transaction to prevent concurrent seat collisions
    await prisma.$transaction(async (tx) => {
        // Fetch all occupied seats on the flight (excluding the current booking's passengers)
        const occupiedPassengers = await tx.passenger.findMany({
            where: {
                booking: {
                    flightId,
                    status: { not: "CANCELLED" }
                },
                bookingId: { not: bookingId }
            },
            select: { seatNumber: true }
        });
        const occupiedSeats = new Set(occupiedPassengers.map(p => p.seatNumber));

        // Validate seat change conflicts
        const newSeats = seatChanges.map(change => change.seatNumber);
        
        // Also check duplicates within the changes themselves
        if (new Set(newSeats).size !== newSeats.length) {
            throw new Error("Duplicate seats selected in request.");
        }

        for (const seat of newSeats) {
            if (occupiedSeats.has(seat)) {
                throw new Error(`Seat ${seat} is already occupied by another passenger.`);
            }
        }

        // Apply changes
        for (const change of seatChanges) {
            // Verify passenger belongs to the booking
            const belongs = booking.passengers.some(p => p.id === change.passengerId);
            if (!belongs) {
                throw new Error(`Passenger ${change.passengerId} does not belong to booking ${bookingId}`);
            }

            await tx.passenger.update({
                where: { id: change.passengerId },
                data: { seatNumber: change.seatNumber }
            });
        }
    });

    revalidatePath('/profile');
    revalidatePath('/admin');
}

export async function deleteReviewAction(reviewId: string) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const review = await prisma.review.findUnique({
        where: { id: reviewId }
    });
    if (!review) throw new Error("Review not found");

    if (session.user.role !== 'ADMIN' && review.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const deleted = await prisma.review.delete({
        where: { id: reviewId }
    });
    revalidatePath('/travelguide');
    revalidatePath('/profile');
    return deleted;
}

export async function saveFlightScheduleAction(data: {
    id?: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureTime: string;
    returnTime: string | null;
    daysOfWeek: number[];
    price: string;
}) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') throw new Error("Unauthorized");

    // Server-side validation
    if (!data.flightNumber || !data.airline || !data.from || !data.to || !data.departureTime || !data.price) {
        throw new Error("Please fill in all required fields.");
    }

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(data.departureTime)) {
        throw new Error("Departure time must be in HH:MM format (24-hour).");
    }

    if (data.returnTime && !timeRegex.test(data.returnTime)) {
        throw new Error("Return time must be in HH:MM format (24-hour) or left empty.");
    }

    if (!Array.isArray(data.daysOfWeek) || data.daysOfWeek.length === 0) {
        throw new Error("Please select at least one day of the week.");
    }

    let savedSchedule;
    if (data.id) {
        savedSchedule = await prisma.flightSchedule.update({
            where: { id: data.id },
            data: {
                flightNumber: data.flightNumber,
                airline: data.airline,
                from: data.from,
                to: data.to,
                departureTime: data.departureTime,
                returnTime: data.returnTime,
                daysOfWeek: data.daysOfWeek,
                price: data.price
            }
        });
    } else {
        savedSchedule = await prisma.flightSchedule.create({
            data: {
                flightNumber: data.flightNumber,
                airline: data.airline,
                from: data.from,
                to: data.to,
                departureTime: data.departureTime,
                returnTime: data.returnTime,
                daysOfWeek: data.daysOfWeek,
                price: data.price
            }
        });
    }

    // Pre-generate flights for the next 30 days from this schedule
    const today = new Date();
    const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let i = 0; i < 30; i++) {
        const date = new Date(utcToday);
        date.setUTCDate(utcToday.getUTCDate() + i);
        const dayOfWeek = date.getUTCDay();

        if (savedSchedule.daysOfWeek.includes(dayOfWeek)) {
            const dateStr = date.toISOString().split('T')[0];
            const departureDate = new Date(`${dateStr}T${savedSchedule.departureTime}:00Z`);
            
            let returnDate = null;
            if (savedSchedule.returnTime) {
                const retDate = new Date(date);
                retDate.setUTCDate(date.getUTCDate() + 7);
                const retDateStr = retDate.toISOString().split('T')[0];
                returnDate = new Date(`${retDateStr}T${savedSchedule.returnTime}:00Z`);
            }

            // Check if flight instance already exists
            const existingInstance = await prisma.flight.findFirst({
                where: {
                    flightNumber: savedSchedule.flightNumber,
                    departureDate: departureDate
                }
            });

            if (!existingInstance) {
                try {
                    await prisma.flight.create({
                        data: {
                            flightNumber: savedSchedule.flightNumber,
                            airline: savedSchedule.airline,
                            from: savedSchedule.from,
                            to: savedSchedule.to,
                            departureDate,
                            returnDate,
                            price: savedSchedule.price,
                            status: 'ON_TIME'
                        }
                    });
                } catch (error) {
                    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
                        throw error;
                    }
                }
            }
        }
    }

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');

    return savedSchedule;
}

export async function deleteFlightScheduleAction(scheduleId: number) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') throw new Error("Unauthorized");

    await prisma.flightSchedule.delete({
        where: { id: scheduleId }
    });

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');
}

export async function updateFlightStatusAction(flightId: number, status: 'ON_TIME' | 'DELAYED' | 'CANCELLED') {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') throw new Error("Unauthorized");

    const updated = await prisma.flight.update({
        where: { id: flightId },
        data: { status }
    });

    revalidatePath('/flights');
    revalidatePath('/admin/flights');
    revalidatePath('/profile');
    revalidatePath('/admin');

    return updated;
}



