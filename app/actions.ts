'use server'

import { revalidatePath } from 'next/cache';
import TravelGuideService from '@/lib/TravelGuideService';
import FlightBookingService from '@/lib/FlightBookingService';
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

export async function searchFlightsAction(from: string, to: string) {
    return await prisma.flight.findMany({
        where: { from, to },
        orderBy: { departureDate: 'asc' },
    });
}

export async function getFlightRoutesAction() {
    // Distinct origin/destination pairs that actually have flights, so the
    // booking form can offer only reachable routes.
    return await prisma.flight.findMany({
        distinct: ['from', 'to'],
        select: { from: true, to: true },
        orderBy: [{ from: 'asc' }, { to: 'asc' }],
    });
}

export async function bookFlightAction(bookingData: { flightId?: number }) {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    return await flightBookingService.bookFlight({
        flightId: bookingData.flightId,
        userId
    });
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

    const deleted = await prisma.booking.delete({
        where: { id: bookingId }
    });
    revalidatePath('/profile');
    revalidatePath('/admin');
    return deleted;
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



