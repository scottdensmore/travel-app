import React from "react";
import PointsActivityTable from "@/components/ui/pointsActivityTable";
import NextStatusChart from "@/components/ui/charts/nextStatusChart";
import PointsHistoryChart from "@/components/ui/charts/pointsHistoryChart";
import PointsActivityService from "@/lib/PointsActivityService";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return <div className="p-8 text-center text-xl">Please log in to view your profile.</div>;
  }

  const user = session.user;
  const userId = (user as any).id;
  const userName = user.name || "Traveler";
  const userAvatar = user.image || "https://i.pravatar.cc/150?u=" + userId;

  const pointsActivityService = new PointsActivityService();
  const activityData = pointsActivityService.getPointsActivity();
  const currentPoints = pointsActivityService.getCurrentPoints().toLocaleString();
  const currentStatus = pointsActivityService.getCurrentStatus();

  const userBookings = await prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { flight: true },
  });

  return (
    <div className="page-container profile">
      <div className="sidebar-menu">
        <div>
          <img src={userAvatar} className="user-avatar" alt="Avatar" />
          <h3>{userName}</h3>
          <p><strong>Current Status:</strong> {currentStatus}</p>
          <p><strong>Status Points:</strong> {currentPoints}</p>
        </div>

        <div>
          <NextStatusChart />
        </div>
        <div className="mt-6">
          <PointsHistoryChart />
        </div>
      </div>

      <div className="content">
        <div className="profile-card">
          <PointsActivityTable activityData={activityData} />
        </div>

        <div className="profile-card mt-8">
          <h2 className="text-2xl font-bold mb-4">My Bookings</h2>
          {userBookings.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2">Flight</th>
                    <th className="pb-2">Route</th>
                    <th className="pb-2">Departure</th>
                    <th className="pb-2">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {userBookings.map((booking) => {
                    const b = booking.flight || booking;
                    return (
                      <tr key={booking.id} className="border-b">
                        <td className="py-2">{b.airline} {b.flightNumber}</td>
                        <td className="py-2">{b.from} &rarr; {b.to}</td>
                        <td className="py-2">{new Date((b as any).departureDate).toLocaleDateString()}</td>
                        <td className="py-2">{b.price}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>You have no bookings yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
