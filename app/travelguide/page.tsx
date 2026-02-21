import React from 'react';
import { prisma } from '@/lib/prisma';
import TravelGuideClient from '@/components/ui/TravelGuideClient';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function TravelGuidePage() {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : null;

    const cities = await prisma.cityGuide.findMany({
        include: { reviews: { include: { user: true } } }
    });

    let initialFavorites: number[] = [];

    if (userId) {
        const favs = await prisma.userFavorite.findMany({
            where: { userId },
            select: { cityGuideId: true }
        });
        initialFavorites = favs.map((f: { cityGuideId: number }) => f.cityGuideId);
    }

    return <TravelGuideClient cities={cities as any} initialFavorites={initialFavorites} />;
}