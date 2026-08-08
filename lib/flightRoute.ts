/**
 * Where a flight goes, read from the airports it references.
 *
 * `Flight.from` and `Flight.to` still exist and still hold the same words, but
 * they are prose that happened to also be the identity of a place. The
 * references added in #73 are the identity; these labels are presentation, and
 * presentation is derived at the read boundary rather than stored twice.
 *
 * Deriving it here rather than in each component is deliberate: every view keeps
 * receiving a flight with `from` and `to` on it, so nothing downstream changes,
 * and dropping the columns becomes a migration rather than a rewrite.
 */

import { airportCodeFor } from './airports';

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
 * Replaces a flight's stored route text with the labels its airports carry.
 *
 * While both exist they say the same thing, so this is invisible — which is the
 * point: it proves nothing reads the columns before they are dropped.
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
