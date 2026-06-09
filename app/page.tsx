import React from "react";
import FlightBookingForm from "../components/ui/flightBookingForm";
import { getFlightRoutesAction } from "./actions";

export default async function Home() {
  const routes = await getFlightRoutesAction();
  return (
    <FlightBookingForm routes={routes} />
  );
}
