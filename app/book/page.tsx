import type { Metadata } from 'next';
import FlightBookingForm from "@/components/ui/flightBookingForm";
import React from 'react';
import { getFlightRoutesAction } from "@/app/actions";

// Reads live flight inventory from the DB, so render per-request rather than
// statically prerendering at build time (which would need a database).
export const metadata: Metadata = {
    title: 'Book flights',
    description: 'Search flights by route, date and cabin, and book your trip with Mona Airways.',
};

export const dynamic = 'force-dynamic';

export default async function Home() {
  const routes = await getFlightRoutesAction();
  return (
    <FlightBookingForm routes={routes} />
  );
}
