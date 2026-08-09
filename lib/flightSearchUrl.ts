import type { FlightRoute } from '@/lib/flightSearch';
import { airportCodeFor, airportLabelFor } from '@/lib/airports';

export type FlightSearchTripType = 'one-way' | 'round-trip';

export const SEARCH_CABINS = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;

export type SearchCabin = (typeof SEARCH_CABINS)[number];

export interface FlightSearchCriteria {
    from: string;
    to: string;
    departureDate: string;
    returnDate: string;
    tripType: FlightSearchTripType;
    /// Results are priced and filtered for this cabin, so a shared link that
    /// omitted it would show a different trip from the one it described.
    cabinClass: SearchCabin;
}

export type FlightSearchParamRecord = Record<
    string,
    string | string[] | undefined
>;

interface BookingWindow {
    earliestDate: string;
    latestDate: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function singleParam(
    params: FlightSearchParamRecord,
    name: string,
): string | undefined {
    const value = params[name];
    return typeof value === 'string' ? value : undefined;
}

function isIsoDate(value: string | undefined): value is string {
    if (!value || !ISO_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime())
        && parsed.toISOString().slice(0, 10) === value;
}

export function parseFlightSearchParams(
    params: FlightSearchParamRecord,
    routes: FlightRoute[],
    bookingWindow: BookingWindow,
): FlightSearchCriteria | undefined {
    if (['from', 'to', 'depart', 'return', 'trip', 'cabin'].some(
        (name) => Array.isArray(params[name])
    )) {
        return undefined;
    }

    // The URL names airports by code. Resolving to the label here keeps the
    // representation change at this boundary: the form, the routes list and the
    // results all still work in words (#73).
    const fromCode = singleParam(params, 'from');
    const toCode = singleParam(params, 'to');
    const from = fromCode === undefined ? undefined : airportLabelFor(fromCode) ?? undefined;
    const to = toCode === undefined ? undefined : airportLabelFor(toCode) ?? undefined;
    const departureDate = singleParam(params, 'depart') ?? '';
    const returnDate = singleParam(params, 'return') ?? '';
    const tripType = singleParam(params, 'trip');
    // An absent cabin is the default, not an invalid link: older shared URLs
    // predate the parameter. An unrecognised one is invalid, because it would
    // silently show a different cabin from the one the link named.
    const cabinParam = singleParam(params, 'cabin');
    if (cabinParam !== undefined && !SEARCH_CABINS.includes(cabinParam as SearchCabin)) {
        return undefined;
    }
    const cabinClass = (cabinParam ?? 'ECONOMY') as SearchCabin;

    if (
        !from
        || !to
        || (tripType !== 'one-way' && tripType !== 'round-trip')
        || !routes.some((route) => route.from === from && route.to === to)
        || (departureDate !== '' && (
            !isIsoDate(departureDate)
            || departureDate < bookingWindow.earliestDate
            || departureDate > bookingWindow.latestDate
        ))
    ) {
        return undefined;
    }

    if (tripType === 'one-way') {
        return {
            from,
            to,
            departureDate,
            returnDate: '',
            tripType,
            cabinClass,
        };
    }

    if (
        (returnDate !== '' && !isIsoDate(returnDate))
        || (returnDate !== '' && departureDate === '')
        || (returnDate !== '' && returnDate < departureDate)
        || (returnDate !== '' && returnDate > bookingWindow.latestDate)
    ) {
        return undefined;
    }

    return {
        from,
        to,
        departureDate,
        returnDate,
        tripType,
        cabinClass,
    };
}

export function buildFlightSearchUrl(
    criteria: FlightSearchCriteria,
    pathname: string,
): string {
    // A link outlives the words it was built from, so it carries the codes.
    // An unknown place cannot produce a usable link; the empty string keeps the
    // parameter present and unparseable rather than silently dropping an end of
    // the route.
    const params = new URLSearchParams({
        from: airportCodeFor(criteria.from) ?? '',
        to: airportCodeFor(criteria.to) ?? '',
    });

    if (criteria.departureDate) {
        params.set('depart', criteria.departureDate);
    }
    if (criteria.tripType === 'round-trip' && criteria.returnDate) {
        params.set('return', criteria.returnDate);
    }
    params.set('trip', criteria.tripType);
    // Economy is the default, so leaving it out keeps the common link short and
    // keeps existing shared URLs identical to the ones this produces.
    if (criteria.cabinClass !== 'ECONOMY') {
        params.set('cabin', criteria.cabinClass);
    }

    return `${pathname}?${params.toString()}`;
}

/** Every parameter that means "this link is asking for a particular search". */
const SEARCH_PARAMS = ['from', 'to', 'depart', 'return', 'trip', 'cabin'] as const;

/**
 * The link asked for a search and this page could not honour it.
 *
 * Distinguishes a refusal from a plain visit, which otherwise look identical:
 * both land on the default form. Without it the address bar names one trip
 * while the page shows another, and nothing says so (#73).
 *
 * Gated on any search parameter rather than on `from`/`to`, so a link refused
 * for its date or its cabin is reported too.
 */
export function isUnusableSearchLink(
    params: FlightSearchParamRecord,
    parsed: FlightSearchCriteria | undefined,
): boolean {
    if (parsed !== undefined) return false;

    return SEARCH_PARAMS.some((name) => params[name] !== undefined);
}
