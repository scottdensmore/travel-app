"use client"
import React from "react";
import TravelGuideForm from "../../../components/ui/travelGuideForm";

export default function Home() {
  return (
      <div className="page-container admin">
      <div className="sidebar-menu" id="sidebar">
        <ul>
          <li><a href="#">New Airports</a></li>
          <li><a href="#">Partners</a></li>
          <li className="selected"><a href="#">Add travel Guide</a></li>
          <li><a href="#">Configuration</a></li>
          <li><a href="#">Manage Corporate</a></li>
        </ul>     
      </div>

      <div className="content">
          <TravelGuideForm />
      </div>
    </div>

  )
}
