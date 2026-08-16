import type { Metadata } from 'next';
import React from "react";
import PointsActivityService from "@/lib/PointsActivityService";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { flightRouteInclude, withLegRouteLabels } from "@/lib/flightRoute";
import ProfileClient from "@/components/ui/ProfileClient";
import { serverRenderTime } from "@/lib/serverClock";
import { safePassengerSelect } from "@/lib/passengerDataAccess";

export const metadata: Metadata = {
    title: 'Your profile',
    description: 'Your bookings, seats, status points and saved travel guides.',
};

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  // Read rather than called in the markup below: see lib/serverClock.
  const renderedAt = await serverRenderTime();

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
    include: {
      // Read the itinerary through its legs, so a round trip needs no change
      // here beyond rendering more than one (#69).
      legs: {
        include: {
          flight: { include: flightRouteInclude },
          // The seat is held per leg, so a round trip has a different one on
          // each; Passenger.seatNumber only ever described the outbound.
          seatAssignments: {
            select: {
              passengerId: true,
              seatNumber: true,
              cabinClass: true,
              // A released seat shows as released rather than as a number that
              // is no longer this customer's (#76).
              releasedAt: true,
            },
          },
        },
        orderBy: { sequence: 'asc' },
      },
      passengers: { select: safePassengerSelect },
      statusChanges: {
        where: { to: 'CANCELLED' },
        orderBy: { sequence: 'desc' },
        take: 1,
        select: {
          refundCents: true,
          paymentRefund: {
            select: { amountCents: true, status: true },
          },
        },
      },
    },
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

  // The route each leg renders comes from the airports its flight references.
  // Resolved once here so the client component and the points activity both
  // keep receiving a flight with `from` and `to` on it (#73).
  const bookings = userBookings.map(booking => ({
    ...booking,
    legs: booking.legs.map(withLegRouteLabels),
  }));

  const pointsActivityService = new PointsActivityService(bookings);
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
      bookings={bookings}
      favorites={userFavorites}
      reviews={userReviews}
      activityData={activityData}
      monthlyHistory={monthlyHistory}
      renderedAt={renderedAt}
    />
  );
}
