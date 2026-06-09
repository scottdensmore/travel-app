import React from "react";
import FlightBookingForm from "../components/ui/flightBookingForm";
import { getFlightRoutesAction } from "./actions";

// Reads live flight inventory from the DB, so render per-request rather than
// statically prerendering at build time (which would need a database).
export const dynamic = 'force-dynamic';

export default async function Home() {
  const routes = await getFlightRoutesAction();
  return (
    <FlightBookingForm routes={routes} />
  );
}
