import type { FlightRoute } from '@/lib/flightSearch';

export type FlightSearchTripType = 'one-way' | 'round-trip';

export interface FlightSearchCriteria {
    from: string;
    to: string;
    departureDate: string;
    returnDate: string;
    tripType: FlightSearchTripType;
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
    if (['from', 'to', 'depart', 'return', 'trip'].some(
        (name) => Array.isArray(params[name])
    )) {
        return undefined;
    }

    const from = singleParam(params, 'from');
    const to = singleParam(params, 'to');
    const departureDate = singleParam(params, 'depart') ?? '';
    const returnDate = singleParam(params, 'return') ?? '';
    const tripType = singleParam(params, 'trip');

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

    return `${pathname}?${params.toString()}`;
}
