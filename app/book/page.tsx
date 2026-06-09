import FlightBookingForm from "@/components/ui/flightBookingForm";
import React from 'react';
import { getFlightRoutesAction } from "@/app/actions";

export default async function Home() {
  const routes = await getFlightRoutesAction();
  return (
    <FlightBookingForm routes={routes} />
  );
}
