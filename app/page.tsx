import React from "react";
import FlightBookingForm from "../components/ui/flightBookingForm";
import { getFlightRoutesAction } from "./actions";
import { bookingWindowIsoDates } from "@/lib/dates";

// Reads live flight inventory from the DB, so render per-request rather than
// statically prerendering at build time (which would need a database).
export const dynamic = 'force-dynamic';

export default async function Home() {
  const routes = await getFlightRoutesAction();
  const { earliestDate, latestDate } = bookingWindowIsoDates();
  return (
    <FlightBookingForm
      routes={routes}
      minimumDepartureDate={earliestDate}
      maximumDepartureDate={latestDate}
    />
  );
}
