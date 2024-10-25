import React from "react";
import PointsActivityTable from "@/components/ui/pointsActivityTable";
import NextStatusChart from "@/components/ui/charts/nextStatusChart";
import PointsActivityService from "@/lib/PointsActivityService";
import UserProfileService from "@/lib/UserProfileService";

export default function Home() {

  const pointsActivityService = new PointsActivityService();
  const activityData = pointsActivityService.getPointsActivity();
  const currentPoints = pointsActivityService.getCurrentPoints().toLocaleString();
  const currentStatus = pointsActivityService.getCurrentStatus();

  const userProfileService = new UserProfileService();
  const userName = userProfileService.getUserName();
  const userAvatar = userProfileService.getUserAvatar();

  return (
    <div className="page-container profile">
      <div className="sidebar-menu">
          <div>
            <img src={userAvatar} className="user-avatar" />
            <h3>{userName}</h3>
            <p><strong>Current Status:</strong> {currentStatus}</p>
            <p><strong>Status Points:</strong> {currentPoints}</p>
          </div>

          <div>
          <NextStatusChart />
          </div>
    </div>

    <div className="content">
      <div className="profile-card">
          <PointsActivityTable activityData={activityData} />
      </div>

    </div>
  </div>
  );
}
