import React from "react";
import FlightBookingForm from "../components/ui/flightBookingForm";
import { getFlightRoutesAction } from "./actions";
import { bookingWindowIsoDates } from "@/lib/dates";
import {
  parseFlightSearchParams,
  type FlightSearchParamRecord,
} from "@/lib/flightSearchUrl";

// Reads live flight inventory from the DB, so render per-request rather than
// statically prerendering at build time (which would need a database).
export const dynamic = 'force-dynamic';

interface HomeProps {
  searchParams: Promise<FlightSearchParamRecord>;
}

export default async function Home({ searchParams }: HomeProps) {
  const [routes, requestedSearch] = await Promise.all([
    getFlightRoutesAction(),
    searchParams,
  ]);
  const { earliestDate, latestDate } = bookingWindowIsoDates();
  const initialSearch = parseFlightSearchParams(
    requestedSearch,
    routes,
    { earliestDate, latestDate },
  );
  return (
    <FlightBookingForm
      routes={routes}
      minimumDepartureDate={earliestDate}
      maximumDepartureDate={latestDate}
      initialSearch={initialSearch}
    />
  );
}
