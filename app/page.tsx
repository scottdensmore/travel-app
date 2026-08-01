import React from "react";
import FlightBookingForm from "../components/ui/flightBookingForm";
import { getFlightRoutesAction } from "./actions";
import { airportTimeZoneFor } from "@/lib/airports";
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
  // Selectable dates are calendar days at the origin airport, so the origin has
  // to be resolved before the window. A shared link carries its own origin; the
  // form otherwise opens on the first available one. The client recomputes this
  // whenever the traveller changes origin.
  const sharedOrigin = typeof requestedSearch.from === 'string' ? requestedSearch.from : undefined;
  const initialOrigin = sharedOrigin ?? routes[0]?.from;
  const { earliestDate, latestDate } = bookingWindowIsoDates(
    new Date(),
    initialOrigin ? airportTimeZoneFor(initialOrigin) : null,
  );
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
