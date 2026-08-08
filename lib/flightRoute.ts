/**
 * Where a flight goes, read from the airports it references.
 *
 * The route was also stored as two text columns until #73 -- prose that happened
 * to also be the identity of a place, so editing it repointed the flight. The
 * references are the identity; the labels are presentation, and presentation is
 * derived at the read boundary rather than stored a second time.
 *
 * Deriving it here rather than in each component is what let the columns go
 * without touching a single view: everything downstream still receives a flight
 * with `from` and `to` on it.
 */

import type { Flight } from '@prisma/client';
import { airportCodeFor } from './airports';

/**
 * A stored flight with its route resolved from the airports it references.
 *
 * The Prisma model has no `from`/`to` of its own since #73, so this is the shape
 * anything rendering a route works with -- and the one `withRouteLabels`
 * produces.
 */
export type RoutedFlight = Flight & { from: string; to: string };

/**
 * The relation any query feeding a route render has to ask for.
 *
 * Spreads into a `select` as readily as an `include`, since both name the
 * airports the same way -- `app/flights/page.tsx` picks its columns explicitly
 * and still uses this.
 */
export const flightRouteInclude = {
    fromAirport: { select: { label: true } },
    toAirport: { select: { label: true } },
} as const;

interface FlightWithAirports {
    fromAirport: { label: string };
    toAirport: { label: string };
}

/**
 * Gives a flight the `from` and `to` its airports name.
 *
 * The stored route text this replaced said the same words, which is what made
 * removing it a migration rather than a rewrite: everything downstream still
 * receives the two keys it always did.
 */
export function withRouteLabels<T extends FlightWithAirports>(flight: T) {
    const { fromAirport, toAirport, ...rest } = flight;
    return { ...rest, from: fromAirport.label, to: toAirport.label };
}

/** The same, for a leg whose flight was loaded with its airports. */
export function withLegRouteLabels<TFlight extends FlightWithAirports, TLeg extends { flight: TFlight | null }>(leg: TLeg) {
    return { ...leg, flight: leg.flight === null ? null : withRouteLabels(leg.flight) };
}

/**
 * Narrows a Flight query to a route, by the airports rather than the prose.
 *
 * `where: { from, to }` matched the label columns, so a search depended on two
 * flights spelling a place identically — and it kept the columns load-bearing
 * long after nothing rendered them.
 *
 * `null` means no airport answers to one of these names, so no flight can be on
 * this route. That is the same empty result the label match gave, reached
 * without a query.
 *
 * Note the asymmetry this introduces, and why it is tolerable: the place asked
 * for is turned into a code through the compiled `AirportData`, while the place
 * rendered comes back from the `Airport` row. Editing a label in the database
 * without editing the data file would leave the form naming one place and the
 * results naming another. Nothing in the application can do that today -- only
 * the seed writes `Airport` -- so this is a coupling to keep in view rather than
 * a live defect, and it closes when the codes come from one source (#105, #191).
 */
export function flightRouteWhere(from: string, to: string): { fromAirportCode: string; toAirportCode: string } | null {
    const fromAirportCode = airportCodeFor(from);
    const toAirportCode = airportCodeFor(to);
    if (fromAirportCode === null || toAirportCode === null) return null;

    return { fromAirportCode, toAirportCode };
}
