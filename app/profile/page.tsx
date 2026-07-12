import React from "react";
import PointsActivityService from "@/lib/PointsActivityService";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProfileClient from "@/components/ui/ProfileClient";

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return <div className="p-8 text-center text-xl" style={{ marginTop: '100px', color: 'black' }}>Please log in to view your profile.</div>;
  }

  const user = session.user;
  const userId = user.id;
  const userName = user.name || "Traveler";
  const userAvatar = user.image || "https://i.pravatar.cc/150?u=" + userId;

  const userBookings = await prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { flight: true, passengers: true },
  });

  const userFavorites = await prisma.userFavorite.findMany({
    where: { userId },
    include: { cityGuide: true },
    orderBy: { createdAt: "desc" }
  });

  const userReviews = await prisma.review.findMany({
    where: { userId },
    include: { cityGuide: true },
    orderBy: { createdAt: "desc" }
  });

  const pointsActivityService = new PointsActivityService(userBookings);
  const activityData = pointsActivityService.getPointsActivity();
  const currentPoints = pointsActivityService.getCurrentPoints();
  const currentStatus = pointsActivityService.getCurrentStatus();
  const monthlyHistory = pointsActivityService.getMonthlyPointsActivity();

  return (
    <ProfileClient 
      userName={userName}
      userAvatar={userAvatar}
      currentStatus={currentStatus}
      currentPoints={currentPoints}
      bookings={userBookings}
      favorites={userFavorites}
      reviews={userReviews}
      activityData={activityData}
      monthlyHistory={monthlyHistory}
    />
  );
}
