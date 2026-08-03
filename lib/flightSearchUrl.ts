import type { FlightRoute } from '@/lib/flightSearch';

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

    const from = singleParam(params, 'from');
    const to = singleParam(params, 'to');
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
    const params = new URLSearchParams({
        from: criteria.from,
        to: criteria.to,
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
