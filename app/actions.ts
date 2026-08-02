'use server'

import { revalidatePath } from 'next/cache';
import TravelGuideService from '@/lib/TravelGuideService';
import FlightBookingService, { PassengerInput } from '@/lib/FlightBookingService';
import CityGuide from '@/lib/types/CityGuide';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';
import { prisma } from '@/lib/prisma';
import { assertSeatAvailableForCabin, validateSeatingLayout } from '@/lib/seatLayout';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { updateFlightSeatingLayout } from '@/lib/FlightSeatLayoutService';
import { actionValidationFailure } from '@/lib/actionResult';
import { bookingTotalCents } from '@/lib/bookingPricing';
import { bookingFlights, outboundFlight } from '@/lib/bookingItinerary';
import { buildFlightRoutes, findNearbyOperatingDates } from '@/lib/flightSearch';
import { airportTimeZoneFor } from '@/lib/airports';
import { bookingWindowIsoDates } from '@/lib/dates';
import {
    bookingRequestSchema,
    cityGuideSchema,
    favoriteSchema,
    flightStatusSchema,
    numericIdSchema,
    occurrenceRequestSchema,
    parseActionInput,
    parseInput,
    reviewSchema,
    scheduleSchema,
    searchFlightsSchema,
    seatChangesSchema,
    stringIdSchema
} from '@/lib/validation';

const travelGuideService = new TravelGuideService();
const flightBookingService = new FlightBookingService();

export async function saveCityGuideAction(cityGuide: CityGuide) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsed = parseActionInput(cityGuideSchema, cityGuide);
    if (!parsed.ok) return parsed;
    const result = await travelGuideService.saveCityGuide(parsed.data as CityGuide);
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
    return result;
}

export async function deleteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsed = parseActionInput(numericIdSchema, cityGuideId);
    if (!parsed.ok) return parsed;
    cityGuideId = parsed.data;
    await prisma.cityGuide.delete({
        where: { id: cityGuideId }
    });
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
}

export async function searchFlightsAction(
    from: string,
    to: string,
    departureDateStr?: string,
    returnDateStr?: string,
) {
    const parsed = parseActionInput(searchFlightsSchema, {
        from,
        to,
        departureDate: departureDateStr === '' || departureDateStr === undefined
            ? undefined
            : departureDateStr,
        returnDate: returnDateStr === '' || returnDateStr === undefined
            ? undefined
            : returnDateStr,
    });
    if (!parsed.ok) return parsed;
    // returnDate is validated by the schema (ordering vs. departure) but does
    // not yet constrain the query, so it is intentionally not destructured here.
    ({ from, to, departureDate: departureDateStr } = parsed.data);

    if (!departureDateStr) {
        const flights = await prisma.flight.findMany({
            where: { from, to },
            orderBy: { departureDate: 'asc' },
        });
        return { flights, nearbyDates: [] };
    }

    // Searching is read-only. Inventory is generated ahead of demand by the
    // seed and by the scheduler running scripts/generate-inventory.ts, so a
    // customer request never writes (#71).
    const searchDate = new Date(departureDateStr);
    const dateStr = searchDate.toISOString().split('T')[0];
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
    const now = new Date();
    const departureLowerBound = startOfDay <= now
        ? { gt: now }
        : { gte: startOfDay };

    const flights = await prisma.flight.findMany({
        where: {
            from,
            to,
            status: { not: 'CANCELLED' },
            departureDate: {
                ...departureLowerBound,
                lte: endOfDay
            }
        },
        orderBy: { departureDate: 'asc' },
    });

    if (flights.length > 0) return { flights, nearbyDates: [] };

    const originTimeZone = airportTimeZoneFor(from);
    const { earliestDate, latestDate } = bookingWindowIsoDates(now, originTimeZone);
    const [schedules, cancelledFlights] = await Promise.all([
        prisma.flightSchedule.findMany({
            where: {
                isActive: true,
                from,
                to,
            },
            select: {
                flightNumber: true,
                departureTime: true,
                daysOfWeek: true,
            },
        }),
        prisma.flight.findMany({
            where: {
                from,
                to,
                status: 'CANCELLED',
                departureDate: {
                    gte: new Date(`${earliestDate}T00:00:00.000Z`),
                    lte: new Date(`${latestDate}T23:59:59.999Z`),
                },
            },
            select: {
                flightNumber: true,
                departureDate: true,
            },
        }),
    ]);

    return {
        flights,
        nearbyDates: findNearbyOperatingDates(
            schedules,
            departureDateStr,
            now,
            cancelledFlights,
            originTimeZone,
        ),
    };
}

export async function getFlightRoutesAction() {
    const schedules = await prisma.flightSchedule.findMany({
        where: { isActive: true },
        select: {
            from: true,
            to: true,
            departureTime: true,
            daysOfWeek: true,
        },
        orderBy: [{ from: 'asc' }, { to: 'asc' }, { departureTime: 'asc' }],
    });

    return buildFlightRoutes(schedules);
}

export async function bookFlightAction(bookingData: { 
    flightId: number;
    passengers: PassengerInput[];
    idempotencyKey: string;
}) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");
    const parsed = parseActionInput(bookingRequestSchema, bookingData);
    if (!parsed.ok) return parsed;
    bookingData = parsed.data as typeof bookingData;

    const result = await flightBookingService.bookFlight({
        flightId: bookingData.flightId,
        userId,
        passengers: bookingData.passengers,
        idempotencyKey: bookingData.idempotencyKey
    });

    try {
        const flight = await prisma.flight.findUnique({ where: { id: bookingData.flightId } });
        if (flight && result.wasCreated) {
            const points = Math.floor(bookingTotalCents(result, flight) / 100);
            await prisma.notification.create({
                data: {
                    userId,
                    title: `Booking Confirmed: ${flight.airline} ${flight.flightNumber}`,
                    message: `Successfully booked flight ${flight.flightNumber} from ${flight.from} to ${flight.to}. Earned +${points} status points.`,
                    type: "POINTS"
                }
            });
        }
    } catch (err) {
        console.error("Failed to generate points notification:", err);
    }

    revalidatePath('/profile');
    return result;
}

export async function getOccupiedSeatsAction(flightId: number) {
    flightId = parseInput(numericIdSchema, flightId);
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

    const parsed = parseActionInput(favoriteSchema, { cityGuideId });
    if (!parsed.ok) return parsed;
    cityGuideId = parsed.data.cityGuideId;
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

    const parsed = parseActionInput(reviewSchema, { cityGuideId, rating, content });
    if (!parsed.ok) return parsed;
    const validated = parsed.data;
    return await prisma.review.create({
        data: {
            userId,
            cityGuideId: validated.cityGuideId,
            rating: validated.rating,
            content: validated.content
        }
    });
}

export async function cancelBookingAction(bookingId: number) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(numericIdSchema, bookingId);
    if (!parsed.ok) return parsed;
    bookingId = parsed.data;
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            legs: {
                include: { flight: true },
                orderBy: { sequence: 'asc' },
            },
        }
    });
    if (!booking) throw new Error("Booking not found");

    if (!hasVerifiedStaffAccess(session) && booking.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const updated = await prisma.$transaction(async (tx) => {
        // Lock every flight the itinerary touches, in leg order, so concurrent
        // cancellations of overlapping itineraries cannot deadlock.
        for (const flight of bookingFlights(booking)) {
            await lockFlightForUpdate(tx, flight.id);
        }
        const lockedBooking = await tx.booking.findUnique({
            where: { id: bookingId },
            select: { status: true }
        });
        if (!lockedBooking) throw new Error("Booking not found");
        if (lockedBooking.status === "CANCELLED") throw new Error("Booking is already cancelled");

        const passengers = await tx.passenger.findMany({
            where: { bookingId },
            select: { id: true, seatNumber: true },
        });
        
        for (const passenger of passengers) {
            // The seat is released by renaming it, so the unique constraint stops
            // holding it. Both tables carry that constraint during the expand
            // phase, so both have to be released or the seat is stranded:
            // occupancy checks read Passenger and would see it free, while
            // SeatAssignment would still refuse the next booking of it.
            const releasedSeat = `CANCELLED-${passenger.id}`;
            await tx.passenger.update({
                where: { id: passenger.id },
                data: { seatNumber: releasedSeat }
            });
            await tx.seatAssignment.updateMany({
                where: { passengerId: passenger.id },
                data: { seatNumber: releasedSeat }
            });
        }

        return await tx.booking.update({
            where: { id: bookingId },
            data: { status: "CANCELLED" }
        });
    });

    try {
        const flight = outboundFlight(booking);
        if (flight && booking.userId) {
            const points = Math.floor(bookingTotalCents(booking, flight) / 100);
            await prisma.notification.create({
                data: {
                    userId: booking.userId,
                    title: `Booking Cancelled: ${flight.airline} ${flight.flightNumber}`,
                    message: `Booking for flight ${flight.flightNumber} has been cancelled. Deducted -${points} status points.`,
                    type: "POINTS"
                }
            });
        }
    } catch (err) {
        console.error("Failed to generate cancellation notification:", err);
    }

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
    const parsed = parseActionInput(seatChangesSchema, { bookingId, seatChanges });
    if (!parsed.ok) return parsed;
    bookingId = parsed.data.bookingId;
    seatChanges = parsed.data.seatChanges;

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            legs: {
                include: { flight: true },
                orderBy: { sequence: 'asc' },
            },
        }
    });
    if (!booking) throw new Error("Booking not found");

    if (!hasVerifiedStaffAccess(session) && booking.userId !== userId) {
        throw new Error("Unauthorized");
    }

    // Seat changes apply to the outbound flight. A round trip will need a leg
    // to be chosen (#69); today there is only one.
    const flightId = outboundFlight(booking)?.id;
    if (!flightId) throw new Error("Flight not found on booking");

    // Execute inside transaction to prevent concurrent seat collisions
    await prisma.$transaction(async (tx) => {
        await lockFlightForUpdate(tx, flightId);
        const lockedBooking = await tx.booking.findUnique({
            where: { id: bookingId },
            select: {
                status: true,
                passengers: { select: { id: true, cabinClass: true } },
            }
        });
        if (!lockedBooking) throw new Error("Booking not found");
        if (lockedBooking.status === "CANCELLED") {
            throw new Error("Seats cannot be changed on a cancelled booking");
        }
        const lockedFlight = await tx.flight.findUnique({ where: { id: flightId } });
        if (!lockedFlight) throw new Error("Flight not found");

        for (const change of seatChanges) {
            const passenger = lockedBooking.passengers.find(p => p.id === change.passengerId);
            if (!passenger) {
                throw new Error(`Passenger ${change.passengerId} does not belong to booking ${bookingId}`);
            }
            assertSeatAvailableForCabin(change.seatNumber, passenger.cabinClass, lockedFlight);
        }

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
            // Both tables hold the seat during the expand phase, so a move that
            // updated only one would leave the old seat locked and the new one
            // held twice.
            await tx.passenger.update({
                where: { id: change.passengerId },
                data: { seatNumber: change.seatNumber }
            });
            await tx.seatAssignment.updateMany({
                where: { passengerId: change.passengerId },
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

    const parsed = parseActionInput(stringIdSchema, reviewId);
    if (!parsed.ok) return parsed;
    reviewId = parsed.data;
    const review = await prisma.review.findUnique({
        where: { id: reviewId }
    });
    if (!review) throw new Error("Review not found");

    if (!hasVerifiedStaffAccess(session) && review.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const deleted = await prisma.review.delete({
        where: { id: reviewId }
    });
    revalidatePath('/travelguide');
    revalidatePath('/profile');
    return deleted;
}

const MAX_OCCURRENCE_RANGE_DAYS = 366;

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
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");
    const parsed = parseActionInput(scheduleSchema, data);
    if (!parsed.ok) return parsed;
    data = parsed.data as typeof data;

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

    const firstClassRows = data.firstClassRows !== undefined && data.firstClassRows !== null ? Number(data.firstClassRows) : 3;
    const businessRows = data.businessRows !== undefined && data.businessRows !== null ? Number(data.businessRows) : 3;
    const premiumEconomyRows = data.premiumEconomyRows !== undefined && data.premiumEconomyRows !== null ? Number(data.premiumEconomyRows) : 4;
    const economyRows = data.economyRows !== undefined && data.economyRows !== null ? Number(data.economyRows) : 20;
    const seatPattern = data.seatPattern ?? "ABC-DEF";

    let normalizedSeatPattern: string;
    try {
        normalizedSeatPattern = validateSeatingLayout(
            firstClassRows,
            businessRows,
            premiumEconomyRows,
            economyRows,
            seatPattern
        );
    } catch (error) {
        return actionValidationFailure(
            error instanceof Error ? error.message : 'Seating layout is invalid.',
            'seatingConfig'
        );
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
                price: data.price,
                firstClassRows,
                businessRows,
                premiumEconomyRows,
                economyRows,
                seatPattern: normalizedSeatPattern
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
                price: data.price,
                firstClassRows,
                businessRows,
                premiumEconomyRows,
                economyRows,
                seatPattern: normalizedSeatPattern
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
                            status: 'ON_TIME',
                            firstClassRows,
                            businessRows,
                            premiumEconomyRows,
                            economyRows,
                            seatPattern: normalizedSeatPattern
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

export async function generateFlightOccurrencesAction(
    scheduleId: number,
    startDateStr: string,
    endDateStr: string,
    seatingConfig?: {
        firstClassRows?: number | null;
        businessRows?: number | null;
        premiumEconomyRows?: number | null;
        economyRows?: number | null;
        seatPattern?: string | null;
    }
) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");
    const parsed = parseActionInput(occurrenceRequestSchema, {
        scheduleId,
        startDate: startDateStr,
        endDate: endDateStr,
        seatingConfig
    });
    if (!parsed.ok) return parsed;
    scheduleId = parsed.data.scheduleId;
    startDateStr = parsed.data.startDate;
    endDateStr = parsed.data.endDate;
    seatingConfig = parsed.data.seatingConfig;

    const schedule = await prisma.flightSchedule.findUnique({
        where: { id: scheduleId }
    });
    if (!schedule) throw new Error("Flight schedule not found.");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
        throw new Error("Dates must use YYYY-MM-DD format.");
    }

    const start = new Date(`${startDateStr}T00:00:00Z`);
    const end = new Date(`${endDateStr}T00:00:00Z`);
    if (
        isNaN(start.getTime()) ||
        isNaN(end.getTime()) ||
        start.toISOString().slice(0, 10) !== startDateStr ||
        end.toISOString().slice(0, 10) !== endDateStr
    ) {
        throw new Error("Invalid start or end date.");
    }
    if (end < start) {
        throw new Error("End date must be on or after start date.");
    }
    const rangeDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (rangeDays > MAX_OCCURRENCE_RANGE_DAYS) {
        throw new Error(`Date range cannot exceed ${MAX_OCCURRENCE_RANGE_DAYS} days.`);
    }

    const firstClassRows = seatingConfig?.firstClassRows !== undefined && seatingConfig?.firstClassRows !== null ? Number(seatingConfig.firstClassRows) : (schedule.firstClassRows ?? 3);
    const businessRows = seatingConfig?.businessRows !== undefined && seatingConfig?.businessRows !== null ? Number(seatingConfig.businessRows) : (schedule.businessRows ?? 3);
    const premiumEconomyRows = seatingConfig?.premiumEconomyRows !== undefined && seatingConfig?.premiumEconomyRows !== null ? Number(seatingConfig.premiumEconomyRows) : (schedule.premiumEconomyRows ?? 4);
    const economyRows = seatingConfig?.economyRows !== undefined && seatingConfig?.economyRows !== null ? Number(seatingConfig.economyRows) : (schedule.economyRows ?? 20);
    const seatPattern = seatingConfig?.seatPattern !== undefined && seatingConfig.seatPattern !== null
        ? seatingConfig.seatPattern
        : (schedule.seatPattern ?? "ABC-DEF");

    let normalizedSeatPattern: string;
    try {
        normalizedSeatPattern = validateSeatingLayout(
            firstClassRows,
            businessRows,
            premiumEconomyRows,
            economyRows,
            seatPattern
        );
    } catch (error) {
        return actionValidationFailure(
            error instanceof Error ? error.message : 'Seating layout is invalid.',
            'seatingConfig'
        );
    }

    const current = new Date(start);
    let occurrencesCreated = 0;
    let occurrencesUpdated = 0;

    while (current <= end) {
        const dayOfWeek = current.getUTCDay();
        if (schedule.daysOfWeek.includes(dayOfWeek)) {
            const dateStr = current.toISOString().split('T')[0];
            const departureDate = new Date(`${dateStr}T${schedule.departureTime}:00Z`);

            let returnDate = null;
            if (schedule.returnTime) {
                const retDate = new Date(current);
                retDate.setUTCDate(current.getUTCDate() + 7);
                const retDateStr = retDate.toISOString().split('T')[0];
                returnDate = new Date(`${retDateStr}T${schedule.returnTime}:00Z`);
            }

            const existingInstance = await prisma.flight.findFirst({
                where: {
                    flightNumber: schedule.flightNumber,
                    departureDate: departureDate
                },
                include: {
                    passengers: {
                        select: { seatNumber: true }
                    }
                }
            });

            if (!existingInstance) {
                try {
                    await prisma.flight.create({
                        data: {
                            flightNumber: schedule.flightNumber,
                            airline: schedule.airline,
                            from: schedule.from,
                            to: schedule.to,
                            departureDate,
                            returnDate,
                            price: schedule.price,
                            status: 'ON_TIME',
                            firstClassRows,
                            businessRows,
                            premiumEconomyRows,
                            economyRows,
                            seatPattern: normalizedSeatPattern
                        }
                    });
                    occurrencesCreated++;
                } catch (error) {
                    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
                        throw error;
                    }
                    const concurrentInstance = await prisma.flight.findFirst({
                        where: {
                            flightNumber: schedule.flightNumber,
                            departureDate
                        }
                    });
                    if (!concurrentInstance) {
                        throw new Error('Concurrent occurrence creation could not be resolved.');
                    }
                    await updateFlightSeatingLayout(concurrentInstance.id, {
                        firstClassRows,
                        businessRows,
                        premiumEconomyRows,
                        economyRows,
                        seatPattern: normalizedSeatPattern
                    });
                    occurrencesUpdated++;
                }
            } else {
                await updateFlightSeatingLayout(existingInstance.id, {
                    firstClassRows,
                    businessRows,
                    premiumEconomyRows,
                    economyRows,
                    seatPattern: normalizedSeatPattern
                });
                occurrencesUpdated++;
            }
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');

    return {
        success: true,
        count: occurrencesCreated + occurrencesUpdated,
        created: occurrencesCreated,
        updated: occurrencesUpdated
    };
}

export async function deleteFlightScheduleAction(scheduleId: number) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsed = parseActionInput(numericIdSchema, scheduleId);
    if (!parsed.ok) return parsed;
    scheduleId = parsed.data;
    await prisma.flightSchedule.delete({
        where: { id: scheduleId }
    });

    revalidatePath('/');
    revalidatePath('/flights');
    revalidatePath('/admin/flights');
}

export async function updateFlightStatusAction(flightId: number, status: 'ON_TIME' | 'DELAYED' | 'CANCELLED') {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) throw new Error("Unauthorized");

    const parsedId = parseActionInput(numericIdSchema, flightId);
    if (!parsedId.ok) return parsedId;
    const parsedStatus = parseActionInput(flightStatusSchema, status);
    if (!parsedStatus.ok) return parsedStatus;
    flightId = parsedId.data;
    status = parsedStatus.data;
    const updated = await prisma.flight.update({
        where: { id: flightId },
        data: { status }
    });

    try {
        const bookings = await prisma.booking.findMany({
            where: { flightId, status: "CONFIRMED" },
            select: { userId: true }
        });

        const uniqueUserIds = Array.from(new Set(bookings.map(b => b.userId).filter(Boolean))) as string[];

        if (uniqueUserIds.length > 0) {
            await prisma.notification.createMany({
                data: uniqueUserIds.map(targetUserId => ({
                    userId: targetUserId,
                    title: `Flight Update: ${updated.airline} ${updated.flightNumber}`,
                    message: `Your upcoming flight ${updated.flightNumber} from ${updated.from} to ${updated.to} is now ${status.replace('_', ' ')}.`,
                    type: "FLIGHT_STATUS"
                }))
            });
        }
    } catch (err) {
        console.error("Failed to generate flight status notifications:", err);
    }

    revalidatePath('/flights');
    revalidatePath('/admin/flights');
    revalidatePath('/profile');
    revalidatePath('/admin');

    return updated;
}

export async function getUserNotificationsAction() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return [];

    return await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
    });
}

export async function markNotificationAsReadAction(id: string) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const parsed = parseActionInput(stringIdSchema, id);
    if (!parsed.ok) return parsed;
    id = parsed.data;
    const notif = await prisma.notification.findUnique({
        where: { id }
    });
    if (!notif || notif.userId !== userId) {
        throw new Error("Unauthorized");
    }

    const updated = await prisma.notification.update({
        where: { id },
        data: { isRead: true }
    });

    revalidatePath('/profile');
    return updated;
}

export async function markAllNotificationsAsReadAction() {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const updated = await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true }
    });

    revalidatePath('/profile');
    return updated;
}
