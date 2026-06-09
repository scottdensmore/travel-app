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
    if ((session?.user as any)?.role !== 'ADMIN') throw new Error("Unauthorized");

    const result = await travelGuideService.saveCityGuide(cityGuide);
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
    return result;
}

export async function deleteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    if ((session?.user as any)?.role !== 'ADMIN') throw new Error("Unauthorized");

    await prisma.cityGuide.delete({
        where: { id: cityGuideId }
    });
    revalidatePath('/admin/travelguide');
    revalidatePath('/travelguide');
}

export async function searchFlightsAction(from: string, to: string) {
    // Mock search by just returning all flights so users can see data regardless of selection
    return await prisma.flight.findMany();
}

export async function bookFlightAction(bookingData: { flightId?: number }) {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : undefined;

    return await flightBookingService.bookFlight({
        flightId: bookingData.flightId,
        userId
    });
}

export async function toggleFavoriteCityGuideAction(cityGuideId: number) {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : undefined;
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
    const userId = session?.user ? (session.user as any).id : undefined;
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

