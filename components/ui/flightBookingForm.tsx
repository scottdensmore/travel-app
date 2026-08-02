"use client"

import * as React from 'react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { searchFlightsAction } from '@/app/actions'
import { Flight } from '@prisma/client'
import { isActionValidationFailure } from '@/lib/actionResult'
import type { FlightRoute } from '@/lib/flightSearch'
import { airportTimeZoneFor } from '@/lib/airports'
import {
    buildFlightSearchUrl,
    type FlightSearchCriteria,
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

interface FlightBookingFormProps {
    routes?: FlightRoute[];
    minimumDepartureDate?: string;
    maximumDepartureDate?: string;
    initialSearch?: FlightSearchCriteria;
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

const FlightBookingForm: React.FC<FlightBookingFormProps> = ({
    routes = [],
    minimumDepartureDate = earliestBookableDateIso(),
    maximumDepartureDate = latestBookableDateIso(),
    initialSearch,
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
    const [flightClass, setFlightClass] = useState('economy');
    const [isOneWay, setIsOneWay] = useState(
        initialSearch?.tripType === 'one-way'
    );
    const previousRouteDefaultsRef = useRef({ fromLocation, toLocation });
    const previousReturnDefaultsRef = useRef({ departureDate, isOneWay });
    const [isSearching, setIsSearching] = useState(false);
    const [isSearchReady, setIsSearchReady] = useState(false);
    const [searchResults, setSearchResults] = useState<Flight[] | null>(null);
    // Return flights for a round trip, searched on their own route and date
    // (#112). Null for a one-way search.
    const [inboundResults, setInboundResults] = useState<Flight[] | null>(null);
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
        setSearchResults((currentResults) => (
            currentResults?.length === 0 ? null : currentResults
        ));
        setBookingState((currentState) => (
            currentState.status === 'error' && currentState.retryCriteria
                ? { status: 'idle' }
                : currentState
        ));
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
        setBookingState({ status: 'idle' });

        setIsSearching(true);
        try {
            const results = await searchFlightsAction(
                criteria.from,
                criteria.to,
                criteria.departureDate,
                criteria.tripType === 'one-way' ? undefined : criteria.returnDate,
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
            }
            setSearchResults(results.flights);
            setNearbyDates(results.nearbyDates);
            setInboundResults(results.inbound?.flights ?? null);
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
    }, []);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        searchRequestIdRef.current += 1;
        setIsSearching(false);
        setSearchResults(null);
        setNearbyDates([]);
        setInboundResults(null);
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
        });
    };

    const handleNearbyDateSearch = async (suggestedDate: string) => {
        const suggestedReturnDate = isOneWay
            ? ''
            : clampToMaximumDate(
                addDaysToIsoDate(suggestedDate, 7),
                latestBookingDateRef.current,
            );
        setDepartureDate(suggestedDate);
        setReturnDate(suggestedReturnDate);
        await performSearch({
            from: fromLocation,
            to: toLocation,
            departureDate: suggestedDate,
            returnDate: suggestedReturnDate,
            tripType: isOneWay ? 'one-way' : 'round-trip',
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

        setDepartureDate(route.nextOperatingDate);
    }, [fromLocation, routes, toLocation]);

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

        const proposedReturnDate = departureDate
            ? addDaysToIsoDate(departureDate, 7)
            : '';
        setReturnDate(
            isOneWay
                ? ''
                : clampToMaximumDate(proposedReturnDate, latestBookingDateRef.current)
        );
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
    const parsePrice = (priceStr?: string): number => {
        if (!priceStr) return 0;
        return parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
    };

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
        const prices = activeResults.map(f => parsePrice(f.price));
        return Math.max(...prices);
    }, [activeResults]);

    const minPriceBoundary = useMemo(() => {
        if (activeResults.length === 0) return 0;
        const prices = activeResults.map(f => parsePrice(f.price));
        return Math.min(...prices);
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
            results = results.filter(f => parsePrice(f.price) <= maxPrice);
        }

        // Filter by Airline
        if (selectedAirlines.length > 0) {
            results = results.filter(f => selectedAirlines.includes(f.airline));
        }

        // Sort results
        results.sort((a, b) => {
            const priceA = parsePrice(a.price);
            const priceB = parsePrice(b.price);
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

                            <li><Link href="#">Multicity</Link></li>
                        </ul>
                    </nav>
                </div>

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
                    <select id="class" name="class" value={flightClass} onChange={e => setFlightClass(e.target.value)}>
                        <option value="economy">Economy</option>
                        <option value="premium-economy">Premium Economy</option>
                        <option value="business">Business</option>
                        <option value="first">First</option>
                    </select>
                </div>

                <div className="checkbox-container">
                    <input type="checkbox" id="rewards" name="rewards" />
                    <label htmlFor="rewards">Search reward flights</label>
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
                                            Max Price: ${maxPrice.toFixed(0)}
                                        </label>
                                        <input 
                                            type="range"
                                            id="price-slider"
                                            min={minPriceBoundary} 
                                            max={maxPriceBoundary} 
                                            value={maxPrice} 
                                            onChange={e => setMaxPrice(parseFloat(e.target.value))}
                                            style={{ width: '100%', cursor: 'pointer', accentColor: '#8b5cf6' }}
                                        />
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                                            <span>${minPriceBoundary.toFixed(0)}</span>
                                            <span>${maxPriceBoundary.toFixed(0)}</span>
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
                                            <div className="flight-result-route">
                                                <div className="flight-result-stop">
                                                    <span suppressHydrationWarning style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>
                                                        {new Date(flight.departureDate).toLocaleDateString()}
                                                    </span>
                                                    <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.from}</span>
                                                </div>
                                                <span className="flight-result-arrow" aria-hidden="true">------&gt;</span>
                                                <div className="flight-result-stop">
                                                    <span suppressHydrationWarning style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>
                                                        {flight.returnDate ? new Date(flight.returnDate).toLocaleDateString() : 'One Way'}
                                                    </span>
                                                    <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.to}</span>
                                                </div>
                                            </div>
                                            <div className="flight-result-fare">
                                                <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34d399' }}>{flight.price}</span>
                                                <Link
                                                    className="flight-result-book"
                                                    href={`/checkout?outbound=${flight.id}`}
                                                >
                                                    Book Now
                                                </Link>
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
                                                        <div className="flight-result-route">
                                                            <div className="flight-result-stop">
                                                                <span suppressHydrationWarning style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>
                                                                    {new Date(flight.departureDate).toLocaleDateString()}
                                                                </span>
                                                                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.from}</span>
                                                            </div>
                                                            <span className="flight-result-arrow" aria-hidden="true">------&gt;</span>
                                                            <div className="flight-result-stop">
                                                                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.to}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flight-result-fare">
                                                            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34d399' }}>{flight.price}</span>
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
