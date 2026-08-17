"use client"

import * as React from 'react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { cabinLabel } from '@/lib/bookingItinerary'
import { searchFlightsAction } from '@/app/actions'
import { Flight } from '@prisma/client'
import type { SearchResultFlight } from '@/app/actions'
import { isActionValidationFailure } from '@/lib/actionResult'
import type { FlightRoute } from '@/lib/flightSearch'
import { airportTimeZoneFor } from '@/lib/airports'
import { flightFareCents, formatPrice } from '@/lib/bookingPricing'
import {
    buildFlightSearchUrl,
    SEARCH_CABINS,
    type FlightSearchCriteria,
    type SearchCabin,
} from '@/lib/flightSearchUrl'
import {
    DEPARTURE_AFTER_BOOKING_WINDOW_MESSAGE,
    RETURN_AFTER_BOOKING_WINDOW_MESSAGE,
    addDaysToIsoDate,
    bookingWindowIsoDates,
    earliestBookableDateIso,
    latestBookableDateIso,
    millisecondsUntilNextLocalDay,
} from '@/lib/dates'
import { durationLabel, flightArrival, flightDeparture } from '@/lib/flightTime'

interface FlightBookingFormProps {
    routes?: FlightRoute[];
    minimumDepartureDate?: string;
    maximumDepartureDate?: string;
    initialSearch?: FlightSearchCriteria;
    /**
     * The link named a search this page could not honour, so the form opened on
     * its own defaults instead.
     *
     * Worth saying out loud: without it the address bar asserts one trip while
     * the page shows another, and a traveller following a stale link has no way
     * to tell (#73).
     */
    unusableLink?: boolean;
}

type BookingState = {
    status: 'idle' | 'booking' | 'success' | 'error';
    message?: string;
    flightId?: number;
    clearOnOneWay?: boolean;
    retryCriteria?: FlightSearchCriteria;
};

const DEPARTURE_REQUIRED_WITH_RETURN_MESSAGE =
    'Departure date is required when a return date is provided.';

function clampToMaximumDate(dateString: string, maximumDate: string): string {
    return dateString && dateString > maximumDate ? maximumDate : dateString;
}

function formatSuggestedDate(dateString: string): string {
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${dateString}T00:00:00.000Z`));
}

/**
 * Says a flight does not operate the cabin that was searched, and that the fare
 * shown is the one it can be booked at instead.
 */
const CabinUnavailableNote: React.FC<{ cabin: SearchCabin }> = ({ cabin }) => (
    <span
        className="cabin-unavailable"
        data-testid="cabin-unavailable"
    >
        No {cabinLabel(cabin)} cabin · Economy fare shown
    </span>
);

function arrivalDayLabel(dayOffset: number): string {
    if (dayOffset === 1) return ' (next day)';
    if (dayOffset < 0) return ' (previous day)';
    if (dayOffset > 1) return ` (${dayOffset} days later)`;
    return '';
}

/** One route clock, shared by outbound and return result cards. */
const FlightResultTiming: React.FC<{ flight: SearchResultFlight }> = ({ flight }) => {
    const departure = flightDeparture(flight);
    const durationMinutes = flight.durationMinutes;
    const arrival = durationMinutes === null || durationMinutes === undefined
        ? null
        : flightArrival({ ...flight, durationMinutes });

    return (
        <div className="flight-result-route">
            <div className="flight-result-stop">
                <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#fff' }}>
                    Departs {departure.readableDate} at {departure.time} {departure.zoneLabel}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.from}</span>
            </div>
            <span className="flight-result-arrow">
                <span aria-hidden="true">------&gt;</span>
                {arrival !== null && <span>{durationLabel(durationMinutes!)}</span>}
            </span>
            <div className="flight-result-stop">
                {arrival !== null && (
                    <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#fff' }}>
                        Arrives {arrival.readableDate} at {arrival.time} {arrival.zoneLabel}
                        {arrivalDayLabel(arrival.dayOffset)}
                    </span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.to}</span>
            </div>
        </div>
    );
};

/**
 * Picks one flight for a leg of a round trip. A toggle rather than a link:
 * nothing is booked until both legs are chosen.
 */
const LegSelectButton: React.FC<{
    flight: Flight;
    leg: 'departing' | 'return';
    isSelected: boolean;
    onSelect: () => void;
}> = ({ flight, leg, isSelected, onSelect }) => (
    <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        aria-label={`Select flight ${flight.flightNumber} as the ${leg} leg`}
        className="flight-result-book"
        style={{
            background: isSelected ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : undefined,
            border: isSelected ? '2px solid #34d399' : '2px solid transparent',
        }}
    >
        {isSelected ? '✓ Selected' : 'Select'}
    </button>
);

/**
 * The return date a departure implies: a week later, never past the end of the
 * booking window, and nothing at all on a one-way trip.
 *
 * Shared so the two places that set it cannot drift -- a route change sets both
 * dates together, and editing the departure alone re-derives this one (#181).
 */
function defaultReturnDate(departureDate: string, isOneWay: boolean, latestDate: string): string {
    if (isOneWay || !departureDate) return '';

    return clampToMaximumDate(addDaysToIsoDate(departureDate, 7), latestDate);
}

const FlightBookingForm: React.FC<FlightBookingFormProps> = ({
    routes = [],
    minimumDepartureDate = earliestBookableDateIso(),
    maximumDepartureDate = latestBookableDateIso(),
    initialSearch,
    unusableLink = false,
}) => {
    const [bookingWindow, setBookingWindow] = useState({
        earliestDate: minimumDepartureDate,
        latestDate: maximumDepartureDate,
    });
    const latestBookingDateRef = useRef(maximumDepartureDate);
    const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
    const searchRequestIdRef = useRef(0);
    const restoredSearchStartedRef = useRef(false);
    // Origins are the distinct departure cities; destinations depend on the
    // selected origin so only reachable routes can be chosen.
    const origins = useMemo(() => Array.from(new Set(routes.map((r) => r.from))), [routes]);
    // Held in state rather than read straight from the prop: the search rewrites
    // the URL with `replaceState`, which never re-renders the server component,
    // so the prop would go on claiming a refusal over results that are now on
    // screen and a URL that now describes them (#73).
    const [linkRefused, setLinkRefused] = useState(unusableLink);

    const [fromLocation, setFromLocation] = useState(
        initialSearch?.from ?? origins[0] ?? ''
    );
    const destinations = useMemo(
        () => routes.filter((r) => r.from === fromLocation).map((r) => r.to),
        [routes, fromLocation]
    );
    const [toLocation, setToLocation] = useState(
        initialSearch?.to ?? destinations[0] ?? ''
    );
    const initialDepartureDate = initialSearch?.departureDate
        ?? routes.find(
            ({ from, to }) => from === fromLocation && to === toLocation
        )?.nextOperatingDate
        ?? '';
    const [departureDate, setDepartureDate] = useState<string>(initialDepartureDate);
    const [returnDate, setReturnDate] = useState<string>(
        initialSearch?.returnDate
        ?? (initialDepartureDate
            ? clampToMaximumDate(
                addDaysToIsoDate(initialDepartureDate, 7),
                bookingWindow.latestDate
            )
            : '')
    );
    const [cabinClass, setCabinClass] = useState<SearchCabin>(
        initialSearch?.cabinClass ?? 'ECONOMY'
    );
    const [isOneWay, setIsOneWay] = useState(
        initialSearch?.tripType === 'one-way'
    );
    const previousRouteDefaultsRef = useRef({ fromLocation, toLocation });
    const previousReturnDefaultsRef = useRef({ departureDate, isOneWay });
    const [isSearching, setIsSearching] = useState(false);
    const [isSearchReady, setIsSearchReady] = useState(false);
    const [searchResults, setSearchResults] = useState<SearchResultFlight[] | null>(null);
    // Return flights for a round trip, searched on their own route and date
    // (#112). Null for a one-way search.
    const [inboundResults, setInboundResults] = useState<SearchResultFlight[] | null>(null);
    // Distinct from an empty inbound list: that return date genuinely has no
    // flights, this means we could not find out (#68).
    const [inboundUnavailable, setInboundUnavailable] = useState(false);
    // A round trip is booked as one itinerary, so both legs are chosen here
    // before checkout rather than one card at a time (#69).
    const [selectedOutboundId, setSelectedOutboundId] = useState<number | null>(null);
    const [selectedInboundId, setSelectedInboundId] = useState<number | null>(null);
    const [nearbyDates, setNearbyDates] = useState<string[]>([]);
    const [bookingState, setBookingState] = useState<BookingState>({ status: 'idle' });

    // Interactive Filters & Sorting States
    const [sortBy, setSortBy] = useState('price-asc');
    const [maxPrice, setMaxPrice] = useState<number>(0);
    const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);

    const clearEmptySearchState = () => {
        searchRequestIdRef.current += 1;
        setIsSearching(false);
        setNearbyDates([]);
        setInboundResults(null);
        setInboundUnavailable(false);
        setSelectedOutboundId(null);
        setSelectedInboundId(null);
        setSearchResults((currentResults) => (
            currentResults?.length === 0 ? null : currentResults
        ));
        setBookingState((currentState) => (
            currentState.status === 'error' && currentState.retryCriteria
                ? { status: 'idle' }
                : currentState
        ));
    };

    /**
     * Every result on screen was priced and marked for the previous cabin, and
     * the checkout link switches to the new one the moment this changes. Unlike
     * a route or date edit, there is nothing here that re-runs the search, so
     * the whole list goes rather than only an already-empty one.
     */
    const handleCabinChange = (nextCabin: SearchCabin) => {
        searchRequestIdRef.current += 1;
        setIsSearching(false);
        setNearbyDates([]);
        setSearchResults(null);
        setInboundResults(null);
        setInboundUnavailable(false);
        setSelectedOutboundId(null);
        setSelectedInboundId(null);
        setBookingState({ status: 'idle' });
        setCabinClass(nextCabin);
    };

    const handleTripTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        clearEmptySearchState();
        const isChangingToOneWay = e.target.value === 'one-way';
        setIsOneWay(isChangingToOneWay);
        // Clear only validation that depends on a return date, which no longer
        // applies once one-way is selected. Other errors remain valid.
        setBookingState((prev) => (
            prev.status === 'error' && prev.retryCriteria
                ? { status: 'idle' }
                : isChangingToOneWay && prev.status === 'error' && prev.clearOnOneWay
                ? { status: 'idle' }
                : prev
        ));
        if (isChangingToOneWay) {
            setReturnDate(''); // Clear return date when switching to one-way
        }
    };

    const performSearch = useCallback(async (
        criteria: FlightSearchCriteria,
        updateUrl = true,
    ) => {
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        setSearchResults(null);
        setNearbyDates([]);
        setInboundResults(null);
        setInboundUnavailable(false);
        // New results, fresh choices: a leg picked before may not be on offer.
        setSelectedOutboundId(null);
        setSelectedInboundId(null);
        setBookingState({ status: 'idle' });

        setIsSearching(true);
        try {
            const results = await searchFlightsAction(
                criteria.from,
                criteria.to,
                criteria.departureDate,
                criteria.tripType === 'one-way' ? undefined : criteria.returnDate,
                criteria.cabinClass,
            );
            if (requestId !== searchRequestIdRef.current) return;
            if (isActionValidationFailure(results)) {
                const clearOnOneWay = Boolean(
                    results.error.fields.returnDate?.includes(results.error.message)
                    || results.error.message === DEPARTURE_REQUIRED_WITH_RETURN_MESSAGE
                );
                setBookingState({
                    status: 'error',
                    message: results.error.message,
                    clearOnOneWay,
                });
                return;
            }
            if (updateUrl) {
                window.history.replaceState(
                    null,
                    '',
                    buildFlightSearchUrl(criteria, window.location.pathname),
                );
                // The address bar now describes what is on screen, so the
                // refusal no longer describes anything.
                setLinkRefused(false);
            }
            setSearchResults(results.flights);
            setNearbyDates(results.nearbyDates);
            const inbound = results.inbound;
            setInboundUnavailable(inbound?.status === 'unavailable');
            setInboundResults(inbound?.status === 'ok' ? inbound.flights : null);
        } catch {
            if (requestId === searchRequestIdRef.current) {
                setBookingState({
                    status: 'error',
                    message: 'Unable to search for flights right now.',
                    retryCriteria: criteria,
                });
            }
        } finally {
            if (requestId === searchRequestIdRef.current) {
                setIsSearching(false);
            }
        }
        // Setters are stable, but the React Compiler infers them as
        // dependencies and skips the component unless they are declared.
    }, [setSelectedOutboundId, setSelectedInboundId]);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        searchRequestIdRef.current += 1;
        setIsSearching(false);
        setSearchResults(null);
        setNearbyDates([]);
        setInboundResults(null);
        setInboundUnavailable(false);
        // New results, fresh choices: a leg picked before may not be on offer.
        setSelectedOutboundId(null);
        setSelectedInboundId(null);
        setBookingState({ status: 'idle' });

        if (departureDate && departureDate < bookingWindow.earliestDate) {
            setBookingState({
                status: 'error',
                message: 'Departure date cannot be in the past.',
            });
            return;
        }
        if (departureDate && departureDate > bookingWindow.latestDate) {
            setBookingState({
                status: 'error',
                message: DEPARTURE_AFTER_BOOKING_WINDOW_MESSAGE,
            });
            return;
        }
        if (!isOneWay && !departureDate && returnDate) {
            setBookingState({
                status: 'error',
                message: DEPARTURE_REQUIRED_WITH_RETURN_MESSAGE,
                clearOnOneWay: true,
            });
            return;
        }
        if (!isOneWay && departureDate && returnDate && returnDate < departureDate) {
            setBookingState({
                status: 'error',
                message: 'Return date cannot be before departure date.',
                clearOnOneWay: true,
            });
            return;
        }
        if (!isOneWay && returnDate && returnDate > bookingWindow.latestDate) {
            setBookingState({
                status: 'error',
                message: RETURN_AFTER_BOOKING_WINDOW_MESSAGE,
                clearOnOneWay: true,
            });
            return;
        }

        await performSearch({
            from: fromLocation,
            to: toLocation,
            departureDate,
            returnDate: isOneWay ? '' : returnDate,
            tripType: isOneWay ? 'one-way' : 'round-trip',
            cabinClass,
        });
    };

    const handleNearbyDateSearch = async (suggestedDate: string) => {
        const suggestedReturnDate = defaultReturnDate(
            suggestedDate, isOneWay, latestBookingDateRef.current,
        );
        setDepartureDate(suggestedDate);
        setReturnDate(suggestedReturnDate);
        await performSearch({
            from: fromLocation,
            to: toLocation,
            departureDate: suggestedDate,
            returnDate: suggestedReturnDate,
            tripType: isOneWay ? 'one-way' : 'round-trip',
            cabinClass,
        });
    };

    /**
     * Re-runs the whole search after the return leg failed. Both legs go again:
     * the action has no way to search one in isolation, and repeating the
     * outbound is cheap next to leaving the customer with half a trip.
     */
    const handleRetryReturnSearch = () => {
        void performSearch({
            from: fromLocation,
            to: toLocation,
            departureDate,
            returnDate: isOneWay ? '' : returnDate,
            tripType: isOneWay ? 'one-way' : 'round-trip',
            cabinClass,
        });
    };

    const handleRetrySearch = () => {
        if (bookingState.status !== 'error' || !bookingState.retryCriteria) return;
        void performSearch(bookingState.retryCriteria);
    };

    // When the origin changes, keep the destination valid for the new origin.
    useEffect(() => {
        if (!destinations.includes(toLocation)) {
            setToLocation(destinations[0] ?? '');
        }
    }, [destinations, toLocation]);

    useEffect(() => {
        const previousRoute = previousRouteDefaultsRef.current;
        if (
            previousRoute.fromLocation === fromLocation
            && previousRoute.toLocation === toLocation
        ) return;
        previousRouteDefaultsRef.current = { fromLocation, toLocation };

        const route = routes.find(
            ({ from, to }) => from === fromLocation && to === toLocation
        );
        if (!route) return;

        // Both dates, in one pass. Setting only the departure and letting the
        // effect below derive the return from it committed a render in
        // between that showed the new route's departure beside the previous
        // route's return -- briefly wrong on screen, and long enough for a
        // spec reading the two inputs to capture the stale one (#181).
        //
        // Claiming the return effect's guard is what stops it running again
        // and recomputing the same value.
        // The window is computed for the new origin rather than read from the
        // ref: the effect that refreshes that ref is declared below this one,
        // so it runs afterwards, and on a route change across timezones the
        // ref still holds the previous origin's last bookable date.
        const { latestDate } = bookingWindowIsoDates(new Date(), airportTimeZoneFor(fromLocation));

        setDepartureDate(route.nextOperatingDate);
        setReturnDate(defaultReturnDate(route.nextOperatingDate, isOneWay, latestDate));
        previousReturnDefaultsRef.current = {
            departureDate: route.nextOperatingDate,
            isOneWay,
        };
    }, [fromLocation, isOneWay, routes, toLocation]);

    // Selectable dates are calendar days at the origin airport, so the window
    // is recomputed when the origin changes and rolls over at that airport's
    // midnight rather than at UTC's.
    const originTimeZone = useMemo(() => airportTimeZoneFor(fromLocation), [fromLocation]);

    useEffect(() => {
        const currentBookingWindow = bookingWindowIsoDates(new Date(), originTimeZone);
        if (
            currentBookingWindow.earliestDate !== bookingWindow.earliestDate
            || currentBookingWindow.latestDate !== bookingWindow.latestDate
        ) {
            latestBookingDateRef.current = currentBookingWindow.latestDate;
            setBookingWindow(currentBookingWindow);
        }

        const rolloverTimer = window.setTimeout(() => {
            const nextBookingWindow = bookingWindowIsoDates(new Date(), originTimeZone);
            latestBookingDateRef.current = nextBookingWindow.latestDate;
            setBookingWindow(nextBookingWindow);
        }, millisecondsUntilNextLocalDay(originTimeZone) + 1);

        return () => window.clearTimeout(rolloverTimer);
    }, [bookingWindow.earliestDate, bookingWindow.latestDate, originTimeZone]);

    useEffect(() => {
        const previousDefaults = previousReturnDefaultsRef.current;
        if (
            previousDefaults.departureDate === departureDate
            && previousDefaults.isOneWay === isOneWay
        ) return;
        previousReturnDefaultsRef.current = { departureDate, isOneWay };

        setReturnDate(defaultReturnDate(departureDate, isOneWay, latestBookingDateRef.current));
    }, [departureDate, isOneWay]);

    useEffect(() => {
        if (!initialSearch || restoredSearchStartedRef.current) return;
        restoredSearchStartedRef.current = true;
        void performSearch(initialSearch, false);
    }, [initialSearch, performSearch]);

    useEffect(() => {
        setIsSearchReady(true);
    }, []);

    useEffect(() => {
        if (searchResults && searchResults.length > 0) {
            resultsHeadingRef.current?.focus();
        }
    }, [searchResults]);

    // Helper to parse price string to number safely (handles $ and commas)
    /**
     * A result's fare in minor units.
     *
     * Sorting and filtering read the value the server stores, not a number
     * recovered from the text it formatted for display. Parsing the label back
     * into a number meant the ordering silently depended on how prices happened
     * to be formatted (#70).
     */
    /** A fare as the customer reads it. */
    const fareLabel = (flight: { priceCents: number }): string =>
        formatPrice(flightFareCents(flight));

    const fareCents = (flight: { priceCents: number }): number => flightFareCents(flight);

    // Filter out cancelled flights from active search results
    const activeResults = useMemo(() => {
        if (!searchResults) return [];
        return searchResults.filter(f => f.status !== 'CANCELLED');
    }, [searchResults]);

    // Unique list of airlines present in the results
    const uniqueAirlines = useMemo(() => {
        return Array.from(new Set(activeResults.map(f => f.airline)));
    }, [activeResults]);

    // Dynamic price boundaries
    const maxPriceBoundary = useMemo(() => {
        if (activeResults.length === 0) return 0;
        const fares = activeResults.map(fareCents).filter(Number.isFinite);
        return fares.length === 0 ? 0 : Math.max(...fares);
    }, [activeResults]);

    const minPriceBoundary = useMemo(() => {
        if (activeResults.length === 0) return 0;
        const fares = activeResults.map(fareCents).filter(Number.isFinite);
        return fares.length === 0 ? 0 : Math.min(...fares);
    }, [activeResults]);

    // Initialize/reset price range filter when boundary changes
    useEffect(() => {
        if (maxPriceBoundary > 0) {
            setMaxPrice(maxPriceBoundary);
        }
    }, [maxPriceBoundary]);

    // Derived filtered and sorted flights list
    const filteredAndSortedResults = useMemo(() => {
        let results = [...activeResults];

        // Filter by Price
        if (maxPrice > 0) {
            // A fare that cannot be read cannot be compared, so the price
            // filter leaves it alone rather than making it disappear by
            // default -- the slider starts at the highest known fare.
            results = results.filter(f => {
                const fare = fareCents(f);
                return !Number.isFinite(fare) || fare <= maxPrice;
            });
        }

        // Filter by Airline
        if (selectedAirlines.length > 0) {
            results = results.filter(f => selectedAirlines.includes(f.airline));
        }

        // Sort results
        results.sort((a, b) => {
            const priceA = fareCents(a);
            const priceB = fareCents(b);
            const timeA = new Date(a.departureDate).getTime();
            const timeB = new Date(b.departureDate).getTime();

            if (sortBy === 'price-asc') {
                return priceA - priceB;
            } else if (sortBy === 'price-desc') {
                return priceB - priceA;
            } else if (sortBy === 'time-asc') {
                return timeA - timeB;
            } else if (sortBy === 'time-desc') {
                return timeB - timeA;
            }
            return 0;
        });

        return results;
    }, [activeResults, maxPrice, selectedAirlines, sortBy]);

    const handleResetFilters = () => {
        setMaxPrice(maxPriceBoundary);
        setSelectedAirlines([]);
        setSortBy('price-asc');
    };

    const bookableInbound = useMemo(
        () => (inboundResults ?? []).filter((flight) => flight.status !== 'CANCELLED'),
        [inboundResults]
    );
    // Only ask for two legs when there is a second leg to choose. A round trip
    // whose return date sold out still books its outbound one card at a time.
    const isChoosingItinerary = inboundResults !== null && bookableInbound.length > 0;

    // Resolved against the flights on offer now, so a selection that a later
    // search dropped can never reach the checkout URL.
    const selectedOutbound = isChoosingItinerary
        ? filteredAndSortedResults.find((flight) => flight.id === selectedOutboundId) ?? null
        : null;
    const selectedInbound = isChoosingItinerary
        ? bookableInbound.find((flight) => flight.id === selectedInboundId) ?? null
        : null;

    const itineraryTotal = useMemo(() => {
        if (!selectedOutbound || !selectedInbound) return null;
        try {
            return formatPrice(
                flightFareCents(selectedOutbound) + flightFareCents(selectedInbound)
            );
        } catch {
            // A malformed stored fare should not take the search page down; the
            // server prices the booking authoritatively at checkout anyway.
            return null;
        }
    }, [selectedOutbound, selectedInbound]);

    // Carried into checkout so the fare quoted there is the one that was shown.
    const cabinParam = cabinClass === 'ECONOMY' ? '' : `&cabin=${cabinClass}`;

    const itineraryPrompt = !selectedOutbound
        ? 'Choose a departing flight.'
        : !selectedInbound
        ? 'Choose a return flight.'
        : `${selectedOutbound.flightNumber} and ${selectedInbound.flightNumber}${itineraryTotal ? ` · ${itineraryTotal} total` : ''}`;

    const renderSearchForm = () => {
        return (
            <form onSubmit={handleSearch} aria-busy={isSearching}>
                <div className="trip">
                    <nav>
                        <ul>
                            <li className={!isOneWay ? 'selected' : ''}>
                                <label>
                                    <input
                                        type="radio"
                                        name="tripType"
                                        value="round-trip"
                                        checked={!isOneWay}
                                        onChange={handleTripTypeChange}
                                        className="oneway"
                                    />
                                    Round Trip
                                </label>
                            </li>

                            <li className={isOneWay ? 'selected' : ''}>
                                <label>
                                    <input
                                        type="radio"
                                        name="tripType"
                                        value="one-way"
                                        checked={isOneWay}
                                        onChange={handleTripTypeChange}
                                        className="oneway"
                                    />
                                    One Way
                                </label>
                            </li>

                        </ul>
                    </nav>
                </div>

                {linkRefused && (
                    <div
                        role="alert"
                        style={{
                            margin: '0 auto 1rem', maxWidth: '800px', width: '100%',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444',
                            color: '#fca5a5', padding: '12px 16px', borderRadius: '8px',
                            textAlign: 'center',
                        }}
                    >
                        That link&apos;s trip is not one we can show — it may name a route we no
                        longer fly, a date outside booking, or an airport we do not serve. Here is
                        a search you can change instead.
                    </div>
                )}

                <div className="fields-container">
                    <label htmlFor="from">From</label>
                    <select id="from" name="from" value={fromLocation} onChange={(e) => {
                        setFromLocation(e.target.value);
                        clearEmptySearchState();
                    }}>
                        {origins.map((loc) => (
                            <option key={loc} value={loc}>{loc}</option>
                        ))}
                    </select>
                </div>

                <div className="fields-container">
                    <label htmlFor="to">To</label>
                    <select id="to" name="to" value={toLocation} onChange={(e) => {
                        setToLocation(e.target.value);
                        clearEmptySearchState();
                    }}>
                        {destinations.map((loc) => (
                            <option key={loc} value={loc}>{loc}</option>
                        ))}
                    </select>
                </div>

                <div className="date-container">
                    <div>
                        <label htmlFor="depart">Depart</label>
                        <input
                            type="date"
                            id="depart"
                            name="depart"
                            min={bookingWindow.earliestDate}
                            max={bookingWindow.latestDate}
                            value={departureDate}
                            onChange={(e) => {
                                setDepartureDate(e.target.value);
                                clearEmptySearchState();
                            }}
                        />
                    </div>
                    <div style={{ marginLeft: '12px' }}
                        className={isOneWay ? 'date-disabled' : ''}
                    >
                        <label htmlFor="returnDate">Return</label>
                        <input
                            type="date"
                            id="returnDate"
                            name="returnDate"
                            className="w-full p-2 border border-gray-300 rounded text-lg"
                            min={departureDate || bookingWindow.earliestDate}
                            max={bookingWindow.latestDate}
                            value={returnDate}
                            onChange={(e) => {
                                setReturnDate(e.target.value);
                                clearEmptySearchState();
                            }}
                            disabled={isOneWay}
                        />
                    </div>
                </div>

                <div className="fields-container">
                    <label htmlFor="class">Cabin class</label>
                    <select
                        id="class"
                        name="class"
                        value={cabinClass}
                        onChange={e => handleCabinChange(e.target.value as SearchCabin)}
                    >
                        {/* Named from the shared label, not written out here:
                            this control said "First" while checkout, the review
                            and the ticket all said "First Class", so a customer
                            picked one cabin and was sold another by name. */}
                        {SEARCH_CABINS.map(cabin => (
                            <option key={cabin} value={cabin}>{cabinLabel(cabin)}</option>
                        ))}
                    </select>
                </div>

                <button type="submit" disabled={isSearching}>
                    {isSearching ? 'Searching...' : 'Find your trip'}
                </button>
            </form>
        );
    };

    return (
        <div
            className="page-container home"
            data-search-ready={isSearchReady ? 'true' : 'false'}
            style={{ minHeight: '100vh', padding: '40px 20px' }}
        >
            <div className="content" style={{
                display: 'flex',
                width: '100%',
                maxHeight: 'none',
                maxWidth: '1200px',
                gap: '2.5rem',
                zIndex: 10,
                alignItems: (searchResults && searchResults.length > 0) ? 'flex-start' : 'center',
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center'
            }}>
                {/* INITIAL STATE or EMPTY SEARCH RESULTS STATE */}
                {(!searchResults || searchResults.length === 0) && (
                    <>
                        <div className="hero-text">
                            <h1>Where Your Journey Takes Flight</h1>
                        </div>
                        <div className="search-trip">
                            <div className="form">
                                {renderSearchForm()}
                            </div>
                            {searchResults && searchResults.length === 0 && (
                                <div className="mt-8 text-center" style={{
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    backdropFilter: 'blur(20px)',
                                    WebkitBackdropFilter: 'blur(20px)',
                                    padding: '24px',
                                    color: 'rgba(255, 255, 255, 0.6)',
                                    marginTop: '24px'
                                }}>
                                    <p style={{ margin: 0 }}>
                                        No flights found for your selected date.
                                    </p>
                                    {nearbyDates.length > 0 && (
                                        <div
                                            aria-label="Nearby operating dates"
                                            style={{ marginTop: '16px' }}
                                        >
                                            <p style={{ margin: '0 0 10px', color: 'rgba(255, 255, 255, 0.8)' }}>
                                                Try a nearby date:
                                            </p>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
                                                {nearbyDates.map((date) => (
                                                    <button
                                                        key={date}
                                                        type="button"
                                                        disabled={isSearching}
                                                        onClick={() => void handleNearbyDateSearch(date)}
                                                        style={{
                                                            border: '1px solid rgba(192, 132, 252, 0.7)',
                                                            borderRadius: '8px',
                                                            background: 'rgba(192, 132, 252, 0.12)',
                                                            color: '#e9d5ff',
                                                            padding: '8px 12px',
                                                            cursor: 'pointer',
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {formatSuggestedDate(date)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* SEARCH RESULTS STATE: Two-Column Portal Dashboard */}
                {searchResults && searchResults.length > 0 && (
                    <>
                        {/* LEFT COLUMN: Modify Search & Filters */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '360px', flexShrink: 0 }}>
                            {/* Compact Search Form Card */}
                            <div className="search-trip" style={{ padding: '1.5rem', maxWidth: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
                                <h3 style={{ fontSize: '1.1rem', color: '#c084fc', margin: '0 0 1rem 0', fontWeight: 'bold' }}>Modify Search</h3>
                                <div className="form">
                                    {renderSearchForm()}
                                </div>
                            </div>

                            {/* Filters Card */}
                            <div style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                backdropFilter: 'blur(25px)',
                                WebkitBackdropFilter: 'blur(25px)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: '16px',
                                padding: '1.5rem',
                                boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
                                color: '#fff'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                                    <h3 style={{ fontSize: '1.1rem', color: '#c084fc', margin: 0, fontWeight: 'bold' }}>Filters</h3>
                                    <button 
                                        onClick={handleResetFilters}
                                        style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: '0.85rem', cursor: 'pointer', fontWeight: '600' }}
                                    >
                                        Reset
                                    </button>
                                </div>

                                {/* Price Slider */}
                                {maxPriceBoundary > minPriceBoundary && (
                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label htmlFor="price-slider" style={{ display: 'block', fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>
                                            Max Price: {formatPrice(maxPrice)}
                                        </label>
                                        <input 
                                            type="range"
                                            id="price-slider"
                                            min={minPriceBoundary} 
                                            max={maxPriceBoundary} 
                                            value={maxPrice} 
                                            step={100}
                                            onChange={e => setMaxPrice(Number(e.target.value))}
                                            style={{ width: '100%', cursor: 'pointer', accentColor: '#8b5cf6' }}
                                        />
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                                            <span>{formatPrice(minPriceBoundary)}</span>
                                            <span>{formatPrice(maxPriceBoundary)}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Airlines Checkboxes */}
                                {uniqueAirlines.length > 1 && (
                                    <div>
                                        <span style={{ display: 'block', fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>
                                            Airlines
                                        </span>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {uniqueAirlines.map(airline => {
                                                const isChecked = selectedAirlines.includes(airline);
                                                return (
                                                    <label key={airline} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>
                                                        <input 
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => {
                                                                if (isChecked) {
                                                                    setSelectedAirlines(selectedAirlines.filter(a => a !== airline));
                                                                } else {
                                                                    setSelectedAirlines([...selectedAirlines, airline]);
                                                                }
                                                            }}
                                                            style={{ width: '16px', height: '16px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                                                        />
                                                        {airline}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Interactive Sorting Controls & Results Panel */}
                        <div style={{ flex: 1, minWidth: '320px', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Sort Bar */}
                            <div style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                backdropFilter: 'blur(20px)',
                                WebkitBackdropFilter: 'blur(20px)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: '16px',
                                padding: '16px 24px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                color: '#fff',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                            }}>
                                <div>
                                    <h2
                                        ref={resultsHeadingRef}
                                        tabIndex={-1}
                                        className="text-2xl font-bold"
                                        style={{ fontSize: '1.25rem', color: '#c084fc', margin: 0, display: 'inline-block' }}
                                    >
                                        Available Flights
                                    </h2>
                                    <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', marginLeft: '12px' }}>
                                        ({filteredAndSortedResults.length} {filteredAndSortedResults.length === 1 ? 'flight' : 'flights'} found)
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label htmlFor="sortBy" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', textTransform: 'uppercase' }}>Sort:</label>
                                    <select 
                                        id="sortBy" 
                                        value={sortBy} 
                                        onChange={e => setSortBy(e.target.value)}
                                        style={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                            border: '1px solid rgba(255, 255, 255, 0.1)',
                                            color: '#fff',
                                            borderRadius: '6px',
                                            padding: '6px 12px',
                                            fontSize: '0.85rem',
                                            outline: 'none',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="price-asc" style={{ backgroundColor: '#181720', color: '#fff' }}>Price: Low to High</option>
                                        <option value="price-desc" style={{ backgroundColor: '#181720', color: '#fff' }}>Price: High to Low</option>
                                        <option value="time-asc" style={{ backgroundColor: '#181720', color: '#fff' }}>Departure: Earliest</option>
                                        <option value="time-desc" style={{ backgroundColor: '#181720', color: '#fff' }}>Departure: Latest</option>
                                    </select>
                                </div>
                            </div>

                            {/* Flights Listing */}
                            {filteredAndSortedResults.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {filteredAndSortedResults.map((flight) => (
                                        <div key={flight.id} className="flight-result-card hover:bg-white/5 transition-colors">
                                            <div className="flight-result-airline">
                                                <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#c084fc' }}>{flight.airline}</span>
                                                <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</span>
                                            </div>
                                            <FlightResultTiming flight={flight} />
                                            <div className="flight-result-fare">
                                                <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34d399' }}>{fareLabel(flight)}</span>
                                                {!flight.cabinAvailable && <CabinUnavailableNote cabin={cabinClass} />}
                                                {isChoosingItinerary ? (
                                                    <LegSelectButton
                                                        flight={flight}
                                                        leg="departing"
                                                        isSelected={selectedOutboundId === flight.id}
                                                        onSelect={() => setSelectedOutboundId(flight.id)}
                                                    />
                                                ) : (
                                                    <Link
                                                        className="flight-result-book"
                                                        href={`/checkout?outbound=${flight.id}${cabinParam}`}
                                                    >
                                                        Book Now
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    backdropFilter: 'blur(20px)',
                                    WebkitBackdropFilter: 'blur(20px)',
                                    padding: '32px',
                                    textAlign: 'center',
                                    color: 'rgba(255, 255, 255, 0.6)'
                                }}>
                                    No flights match your filter criteria. Try resetting your filters.
                                </div>
                            )}

                            {/*
                              * Return flights for a round trip, searched on their
                              * own route and date. Listed without a booking
                              * action: choosing one is only meaningful once
                              * checkout can carry an itinerary rather than a
                              * single flight.
                              */}
                            {inboundUnavailable && (
                                <div
                                    className="search-degraded"
                                    data-testid="inbound-unavailable"
                                    role="status"
                                >
                                    <h3>Return flights unavailable</h3>
                                    <p>
                                        We could not load return flights just now. Your outbound
                                        results above are up to date.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleRetryReturnSearch}
                                        disabled={isSearching}
                                    >
                                        Retry return flights
                                    </button>
                                </div>
                            )}

                            {inboundResults !== null && (
                                <div style={{ marginTop: '2.5rem' }} data-testid="inbound-results">
                                    <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', marginBottom: '1rem' }}>
                                        Return flights
                                    </h3>
                                    {inboundResults.filter((flight) => flight.status !== 'CANCELLED').length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                            {inboundResults
                                                .filter((flight) => flight.status !== 'CANCELLED')
                                                .map((flight) => (
                                                    <div key={flight.id} className="flight-result-card">
                                                        <div className="flight-result-airline">
                                                            <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#c084fc' }}>{flight.airline}</span>
                                                            <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</span>
                                                        </div>
                                                        <FlightResultTiming flight={flight} />
                                                        <div className="flight-result-fare">
                                                            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34d399' }}>{fareLabel(flight)}</span>
                                                            {!flight.cabinAvailable && <CabinUnavailableNote cabin={cabinClass} />}
                                                            <LegSelectButton
                                                                flight={flight}
                                                                leg="return"
                                                                isSelected={selectedInboundId === flight.id}
                                                                onSelect={() => setSelectedInboundId(flight.id)}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    ) : (
                                        <p style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                                            No return flights available on this date.
                                        </p>
                                    )}
                                </div>
                            )}

                            {isChoosingItinerary && (
                                <div
                                    className="round-trip-bar"
                                    style={{
                                        marginTop: '2rem',
                                        padding: '1rem 1.5rem',
                                        borderRadius: '12px',
                                        background: 'rgba(255, 255, 255, 0.03)',
                                        border: '1px solid rgba(255, 255, 255, 0.08)',
                                    }}
                                >
                                    <p
                                        data-testid="round-trip-summary"
                                        role="status"
                                        aria-live="polite"
                                        style={{ color: 'rgba(255,255,255,0.85)', margin: 0 }}
                                    >
                                        {itineraryPrompt}
                                    </p>
                                    {/*
                                      * A link once there is somewhere to go, and a
                                      * button until then. `href=""` would still be a
                                      * link to this page, and `disabled` would hide
                                      * the control from the reader who most needs the
                                      * summary above to explain what is missing.
                                      */}
                                    {selectedOutbound && selectedInbound ? (
                                        <Link
                                            data-testid="round-trip-book"
                                            className="flight-result-book"
                                            href={`/checkout?outbound=${selectedOutbound.id}&inbound=${selectedInbound.id}${cabinParam}`}
                                        >
                                            Book round trip
                                        </Link>
                                    ) : (
                                        <button
                                            data-testid="round-trip-book"
                                            type="button"
                                            aria-disabled="true"
                                            onClick={(event) => event.preventDefault()}
                                            className="flight-result-book"
                                            // Dimming the gradient to 0.5 put the
                                            // label at 2.9:1. This control is
                                            // aria-disabled, not disabled, so it is
                                            // still in the a11y tree and still has to
                                            // be readable.
                                            style={{
                                                // Opaque on purpose: the page has a
                                                // photographic background, so a
                                                // translucent fill would make the
                                                // label's contrast depend on whatever
                                                // happens to be behind it.
                                                background: '#2b2938',
                                                backgroundImage: 'none',
                                                color: 'rgba(255, 255, 255, 0.92)',
                                                border: '1px solid rgba(255, 255, 255, 0.25)',
                                                boxShadow: 'none',
                                                cursor: 'not-allowed',
                                            }}
                                        >
                                            Book round trip
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {bookingState.status === 'success' && (
                    <div style={{ marginTop: '2rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', color: '#10b981', padding: '12px 16px', borderRadius: '8px', width: '100%', maxWidth: '800px', textAlign: 'center' }} role="alert">
                        <span>{bookingState.message}</span>
                    </div>
                )}
                {isSearching && (
                    <div
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        style={{
                            marginTop: '2rem',
                            backgroundColor: 'rgba(192, 132, 252, 0.1)',
                            border: '1px solid rgba(192, 132, 252, 0.7)',
                            color: '#e9d5ff',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            width: '100%',
                            maxWidth: '800px',
                            textAlign: 'center',
                        }}
                    >
                        Searching for flights…
                    </div>
                )}
                {bookingState.status === 'error' && (
                    <div style={{ marginTop: '2rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#fca5a5', padding: '12px 16px', borderRadius: '8px', width: '100%', maxWidth: '800px', textAlign: 'center' }} role="alert">
                        <p style={{ margin: 0 }}>{bookingState.message}</p>
                        {bookingState.retryCriteria && (
                            <button
                                type="button"
                                onClick={handleRetrySearch}
                                disabled={isSearching}
                                style={{
                                    marginTop: '12px',
                                    border: '1px solid #fca5a5',
                                    borderRadius: '8px',
                                    background: 'rgba(239, 68, 68, 0.12)',
                                    color: '#fff',
                                    padding: '8px 14px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                }}
                            >
                                Retry search
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export default FlightBookingForm
