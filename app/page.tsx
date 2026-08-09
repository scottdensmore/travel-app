import type { Metadata } from 'next';
import { BRAND, pageTitle } from '@/lib/brand';
import React from "react";
import FlightBookingForm from "../components/ui/flightBookingForm";
import { getFlightRoutesAction } from "./actions";
import { airportLabelFor, airportTimeZoneFor } from "@/lib/airports";
import { bookingWindowIsoDates } from "@/lib/dates";
import {
  isUnusableSearchLink,
  parseFlightSearchParams,
  type FlightSearchParamRecord,
} from "@/lib/flightSearchUrl";

// Reads live flight inventory from the DB, so render per-request rather than
// statically prerendering at build time (which would need a database).
/**
 * The social card.
 *
 * Declared here rather than in the root layout because this route renders per
 * request. `metadataBase` resolves when a page renders, so a card at the root
 * baked the build machine's URL into every prerendered auth page — in a
 * container image, `http://localhost:3000/img/og-image.jpg`, which fetches
 * nothing. An auth page needs no marketing card anyway (#140).
 */
const socialCard = {
    // Just the name: the image already carries the tagline, and an unfurl
    // stacks the title directly above the image, so repeating it printed the
    // same sentence twice in two different casings.
    title: BRAND.name,
    description: BRAND.description,
    images: [{
        url: '/img/og-image.jpg',
        width: 1200,
        height: 630,
        alt: `${BRAND.name} — ${BRAND.tagline}`,
    }],
};

export const metadata: Metadata = {
    // Spelled out rather than relying on the template: Next applies that to
    // child segments, and this page shares a segment with the root layout.
    title: pageTitle('Book flights'),
    description: 'Search flights by route, date and cabin, and book your trip with Mona Airways.',
    openGraph: { type: 'website', siteName: BRAND.name, url: '/', ...socialCard },
    twitter: { card: 'summary_large_image', ...socialCard },
};

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
  // The link names the origin by airport code, so it resolves to words before
  // it can be compared with a route or looked up for a timezone (#73). An
  // unknown code falls through to the first route the same way a missing one
  // does -- `parseFlightSearchParams` is what rejects the link itself.
  const sharedOriginCode = typeof requestedSearch.from === 'string' ? requestedSearch.from : undefined;
  const sharedOrigin = sharedOriginCode === undefined ? undefined : airportLabelFor(sharedOriginCode) ?? undefined;
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
  const unusableLink = isUnusableSearchLink(requestedSearch, initialSearch);

  // A refused link must not keep its grip on the booking window. The origin
  // above was resolved before parsing, because the window is what parsing
  // validates dates against -- so when parsing then rejects the link, the
  // selectable dates have to come back to the origin the form is actually
  // showing (#73).
  const window = unusableLink && sharedOrigin
    ? bookingWindowIsoDates(new Date(), routes[0]?.from ? airportTimeZoneFor(routes[0].from) : null)
    : { earliestDate, latestDate };

  return (
    <FlightBookingForm
      routes={routes}
      minimumDepartureDate={window.earliestDate}
      maximumDepartureDate={window.latestDate}
      initialSearch={initialSearch}
      unusableLink={unusableLink}
    />
  );
}
