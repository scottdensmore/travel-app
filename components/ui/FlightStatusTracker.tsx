"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { FlightStatusResult } from '@/lib/flightStatusService';
import type { FlightStatusSearchInput } from '@/lib/validation';
import type { FlightPhase } from '@/lib/flightPhase';
import { searchFlightStatusAction } from '@/app/actions';
import { airportTimeZoneFor } from '@/lib/airports';
import { departureInOriginZone } from '@/lib/flightTime';

export interface FlightStatusTrackerProps {
    initialFlights?: FlightStatusResult[];
    initialSearch?: FlightStatusSearchInput | null;
    coverage?: string;
}

function getBadgeDetails(flight: FlightStatusResult): {
    label: string;
    ariaLabel?: string;
    style: React.CSSProperties;
    isBoarding: boolean;
} {
    if (flight.phase === 'BOARDING') {
        return {
            label: 'Now Boarding',
            ariaLabel: `Now Boarding - Gate ${flight.gates.departureGate}`,
            style: {
                backgroundColor: 'rgba(245, 158, 11, 0.2)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.5)',
            },
            isBoarding: true,
        };
    }

    if (flight.phase === 'CANCELLED' || flight.status === 'CANCELLED') {
        return {
            label: 'Cancelled',
            style: {
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
            },
            isBoarding: false,
        };
    }

    if (flight.phase === 'DELAYED' || flight.status === 'DELAYED') {
        return {
            label: 'Delayed',
            style: {
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
            },
            isBoarding: false,
        };
    }

    if (flight.phase === 'DEPARTED') {
        return {
            label: 'Departed',
            style: {
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa',
                border: '1px solid rgba(59, 130, 246, 0.3)',
            },
            isBoarding: false,
        };
    }

    if (flight.phase === 'ARRIVED') {
        return {
            label: 'Arrived',
            style: {
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                color: '#c4b5fd',
                border: '1px solid rgba(139, 92, 246, 0.3)',
            },
            isBoarding: false,
        };
    }

    // Default: UPCOMING / ON_TIME
    return {
        label: 'On Time',
        style: {
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.3)',
        },
        isBoarding: false,
    };
}

function getProgressPercent(phase: FlightPhase): number {
    switch (phase) {
        case 'ARRIVED':
            return 100;
        case 'DEPARTED':
            return 65;
        case 'BOARDING':
            return 25;
        case 'UPCOMING':
        case 'DELAYED':
        case 'CANCELLED':
        default:
            return 0;
    }
}

export default function FlightStatusTracker({
    initialFlights = [],
    initialSearch = null,
    coverage = 'today',
}: FlightStatusTrackerProps) {
    const [mode, setMode] = useState<'flightNumber' | 'route'>(
        initialSearch?.mode ?? 'flightNumber'
    );
    const [flightNumber, setFlightNumber] = useState(
        initialSearch?.mode === 'flightNumber' ? initialSearch.flightNumber : ''
    );
    const [flightDate, setFlightDate] = useState(
        initialSearch?.mode === 'flightNumber' ? initialSearch.date ?? '' : ''
    );
    const [origin, setOrigin] = useState(
        initialSearch?.mode === 'route' ? initialSearch.from : ''
    );
    const [destination, setDestination] = useState(
        initialSearch?.mode === 'route' ? initialSearch.to : ''
    );
    const [routeDate, setRouteDate] = useState(
        initialSearch?.mode === 'route' ? initialSearch.date ?? '' : ''
    );

    const [flights, setFlights] = useState<FlightStatusResult[]>(initialFlights);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(
        initialFlights.length > 0 || initialSearch !== null
    );

    useEffect(() => {
        setFlights(initialFlights);
        if (initialFlights.length > 0 || initialSearch !== null) {
            setHasSearched(true);
        }
    }, [initialFlights, initialSearch]);

    const handleSearchByFlightNumber = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const trimmedNumber = flightNumber.trim().toUpperCase();
        if (!trimmedNumber) return;

        setIsLoading(true);
        setError(null);

        const dateVal = flightDate.trim() || undefined;
        const searchInput: FlightStatusSearchInput = {
            mode: 'flightNumber',
            flightNumber: trimmedNumber,
            date: dateVal,
        };

        // Deep link update
        const params = new URLSearchParams();
        params.set('flight', trimmedNumber);
        if (dateVal) params.set('date', dateVal);
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', `/flight-status?${params.toString()}`);
        }

        try {
            const res = await searchFlightStatusAction(searchInput);
            if (res.ok) {
                setFlights(res.data);
                setHasSearched(true);
            } else {
                setError(res.error.message);
                setFlights([]);
                setHasSearched(true);
            }
        } catch {
            setError('Failed to fetch flight status. Please try again.');
            setFlights([]);
            setHasSearched(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearchByRoute = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const trimmedOrigin = origin.trim().toUpperCase();
        const trimmedDest = destination.trim().toUpperCase();
        if (!trimmedOrigin || !trimmedDest) return;

        setIsLoading(true);
        setError(null);

        const dateVal = routeDate.trim() || undefined;
        const searchInput: FlightStatusSearchInput = {
            mode: 'route',
            from: trimmedOrigin,
            to: trimmedDest,
            date: dateVal,
        };

        // Deep link update
        const params = new URLSearchParams();
        params.set('from', trimmedOrigin);
        params.set('to', trimmedDest);
        if (dateVal) params.set('date', dateVal);
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', `/flight-status?${params.toString()}`);
        }

        try {
            const res = await searchFlightStatusAction(searchInput);
            if (res.ok) {
                setFlights(res.data);
                setHasSearched(true);
            } else {
                setError(res.error.message);
                setFlights([]);
                setHasSearched(true);
            }
        } catch {
            setError('Failed to fetch flight status. Please try again.');
            setFlights([]);
            setHasSearched(true);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="flight-status-tracker-container"
            style={{
                width: '100%',
                maxWidth: '960px',
                margin: '0 auto',
                padding: '1.5rem 1rem',
                color: '#fff',
                boxSizing: 'border-box',
            }}
        >
            <style>{`
                @keyframes pulseAmber {
                    0%, 100% {
                        opacity: 1;
                        box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4);
                    }
                    50% {
                        opacity: 0.9;
                        box-shadow: 0 0 0 8px rgba(245, 158, 11, 0);
                    }
                }
                .badge-boarding-pulsing {
                    animation: pulseAmber 2s infinite ease-in-out;
                }
            `}</style>

            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h1
                    style={{
                        fontSize: '2.25rem',
                        fontWeight: 'bold',
                        color: '#c084fc',
                        marginBottom: '0.5rem',
                    }}
                >
                    Flight Status Tracker
                </h1>
                <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '1rem' }}>
                    Track real-time flight status, departure and arrival times, gate assignments, and route progress.
                </p>
                <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    Coverage: {coverage}
                </p>
            </div>

            {/* Search Tabs */}
            <div
                role="tablist"
                aria-label="Flight Status Search Tabs"
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    marginBottom: '1.5rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    paddingBottom: '0.5rem',
                }}
            >
                <button
                    type="button"
                    role="tab"
                    id="tab-flight-number"
                    aria-selected={mode === 'flightNumber'}
                    aria-controls="panel-flight-number"
                    onClick={() => {
                        setMode('flightNumber');
                        setError(null);
                    }}
                    style={{
                        padding: '0.75rem 1.25rem',
                        fontSize: '1rem',
                        fontWeight: '600',
                        color: mode === 'flightNumber' ? '#c084fc' : 'rgba(255, 255, 255, 0.7)',
                        backgroundColor: mode === 'flightNumber' ? 'rgba(192, 132, 252, 0.1)' : 'transparent',
                        border: 'none',
                        borderBottom: mode === 'flightNumber' ? '2px solid #c084fc' : '2px solid transparent',
                        borderRadius: '6px 6px 0 0',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                >
                    By Flight Number
                </button>
                <button
                    type="button"
                    role="tab"
                    id="tab-route"
                    aria-selected={mode === 'route'}
                    aria-controls="panel-route"
                    onClick={() => {
                        setMode('route');
                        setError(null);
                    }}
                    style={{
                        padding: '0.75rem 1.25rem',
                        fontSize: '1rem',
                        fontWeight: '600',
                        color: mode === 'route' ? '#c084fc' : 'rgba(255, 255, 255, 0.7)',
                        backgroundColor: mode === 'route' ? 'rgba(192, 132, 252, 0.1)' : 'transparent',
                        border: 'none',
                        borderBottom: mode === 'route' ? '2px solid #c084fc' : '2px solid transparent',
                        borderRadius: '6px 6px 0 0',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                >
                    By Route
                </button>
            </div>

            {/* Search Form Card */}
            <div
                style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '16px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '1.5rem',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    marginBottom: '2rem',
                }}
            >
                {mode === 'flightNumber' ? (
                    <div
                        role="tabpanel"
                        id="panel-flight-number"
                    >
                        <form
                            onSubmit={handleSearchByFlightNumber}
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '1rem',
                                alignItems: 'flex-end',
                            }}
                        >
                            <div style={{ flex: '2 1 200px', minWidth: 0 }}>
                                <label
                                    htmlFor="flight-number-input"
                                    style={{
                                        display: 'block',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        marginBottom: '0.5rem',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                    }}
                                >
                                    Flight Number
                                </label>
                                <input
                                    id="flight-number-input"
                                    data-testid="flight-number-input"
                                    type="text"
                                    placeholder="e.g. MA101"
                                    value={flightNumber}
                                    onChange={(e) => setFlightNumber(e.target.value)}
                                    required
                                    style={{
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        backgroundColor: '#181720',
                                        color: '#fff',
                                        fontSize: '1rem',
                                    }}
                                />
                            </div>
                            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                <label
                                    htmlFor="flight-date-input"
                                    style={{
                                        display: 'block',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        marginBottom: '0.5rem',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                    }}
                                >
                                    Departure Date
                                </label>
                                <input
                                    id="flight-date-input"
                                    data-testid="flight-date-input"
                                    type="date"
                                    value={flightDate}
                                    onChange={(e) => setFlightDate(e.target.value)}
                                    style={{
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        backgroundColor: '#181720',
                                        color: '#fff',
                                        fontSize: '1rem',
                                    }}
                                />
                            </div>
                            <div style={{ flex: '0 0 auto' }}>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    data-testid="search-flight-button"
                                    style={{
                                        padding: '0.75rem 1.75rem',
                                        fontSize: '1rem',
                                        fontWeight: 'bold',
                                        borderRadius: '8px',
                                        backgroundColor: '#9333ea',
                                        color: '#fff',
                                        border: 'none',
                                        cursor: isLoading ? 'not-allowed' : 'pointer',
                                        opacity: isLoading ? 0.7 : 1,
                                        transition: 'background-color 0.2s',
                                    }}
                                >
                                    {isLoading ? 'Searching...' : 'Search Flight'}
                                </button>
                            </div>
                        </form>
                    </div>
                ) : (
                    <div
                        role="tabpanel"
                        id="panel-route"
                    >
                        <form
                            onSubmit={handleSearchByRoute}
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '1rem',
                                alignItems: 'flex-end',
                            }}
                        >
                            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                <label
                                    htmlFor="origin-airport-input"
                                    style={{
                                        display: 'block',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        marginBottom: '0.5rem',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                    }}
                                >
                                    Origin Airport
                                </label>
                                <input
                                    id="origin-airport-input"
                                    data-testid="origin-airport-input"
                                    type="text"
                                    placeholder="e.g. SEA"
                                    maxLength={3}
                                    value={origin}
                                    onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                                    required
                                    style={{
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        backgroundColor: '#181720',
                                        color: '#fff',
                                        fontSize: '1rem',
                                    }}
                                />
                            </div>
                            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                <label
                                    htmlFor="destination-airport-input"
                                    style={{
                                        display: 'block',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        marginBottom: '0.5rem',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                    }}
                                >
                                    Destination Airport
                                </label>
                                <input
                                    id="destination-airport-input"
                                    data-testid="destination-airport-input"
                                    type="text"
                                    placeholder="e.g. DTW"
                                    maxLength={3}
                                    value={destination}
                                    onChange={(e) => setDestination(e.target.value.toUpperCase())}
                                    required
                                    style={{
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        backgroundColor: '#181720',
                                        color: '#fff',
                                        fontSize: '1rem',
                                    }}
                                />
                            </div>
                            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                <label
                                    htmlFor="route-date-input"
                                    style={{
                                        display: 'block',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        marginBottom: '0.5rem',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                    }}
                                >
                                    Departure Date
                                </label>
                                <input
                                    id="route-date-input"
                                    data-testid="route-date-input"
                                    type="date"
                                    value={routeDate}
                                    onChange={(e) => setRouteDate(e.target.value)}
                                    style={{
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        backgroundColor: '#181720',
                                        color: '#fff',
                                        fontSize: '1rem',
                                    }}
                                />
                            </div>
                            <div style={{ flex: '0 0 auto' }}>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    data-testid="search-route-button"
                                    style={{
                                        padding: '0.75rem 1.75rem',
                                        fontSize: '1rem',
                                        fontWeight: 'bold',
                                        borderRadius: '8px',
                                        backgroundColor: '#9333ea',
                                        color: '#fff',
                                        border: 'none',
                                        cursor: isLoading ? 'not-allowed' : 'pointer',
                                        opacity: isLoading ? 0.7 : 1,
                                        transition: 'background-color 0.2s',
                                    }}
                                >
                                    {isLoading ? 'Searching...' : 'Search Route'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>

            {/* Error Message Banner */}
            {error && (
                <div
                    role="alert"
                    style={{
                        padding: '1rem 1.25rem',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '12px',
                        color: '#fca5a5',
                        marginBottom: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                    }}
                >
                    <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>⚠️</span>
                    <span>{error}</span>
                </div>
            )}

            {/* Results Section */}
            {isLoading ? (
                <div
                    role="status"
                    style={{
                        padding: '3rem 1.5rem',
                        textAlign: 'center',
                        color: 'rgba(255, 255, 255, 0.7)',
                    }}
                >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Loading flight status...</div>
                </div>
            ) : flights.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {flights.map((flight) => {
                        const badge = getBadgeDetails(flight);
                        const progress = getProgressPercent(flight.phase);
                        const isDelayed = flight.phase === 'DELAYED' || flight.status === 'DELAYED' || Boolean(flight.delayReason);

                        const originZone = airportTimeZoneFor(flight.fromAirportCode);
                        const destZone = airportTimeZoneFor(flight.toAirportCode);

                        const actualDepFormatted = flight.actualDeparture
                            ? departureInOriginZone(flight.actualDeparture, originZone)
                            : null;
                        const estDepFormatted = flight.estimatedDeparture
                            ? departureInOriginZone(flight.estimatedDeparture, originZone)
                            : null;

                        const actualArrFormatted = flight.actualArrival
                            ? departureInOriginZone(flight.actualArrival, destZone)
                            : null;
                        const estArrFormatted = flight.estimatedArrival
                            ? departureInOriginZone(flight.estimatedArrival, destZone)
                            : null;

                        return (
                            <div
                                key={flight.id}
                                style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    padding: '1.5rem',
                                    backdropFilter: 'blur(20px)',
                                    WebkitBackdropFilter: 'blur(20px)',
                                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
                                    overflow: 'hidden',
                                }}
                            >
                                {/* Header: Airline, Flight Number, Status Badge */}
                                <div
                                    style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                                        paddingBottom: '1rem',
                                        marginBottom: '1.25rem',
                                    }}
                                >
                                    <div>
                                        <span
                                            style={{
                                                fontSize: '1.5rem',
                                                fontWeight: 'bold',
                                                color: '#fff',
                                                marginRight: '0.75rem',
                                            }}
                                        >
                                            {flight.flightNumber}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: '1rem',
                                                color: '#c084fc',
                                                fontWeight: '600',
                                            }}
                                        >
                                            {flight.airline}
                                        </span>
                                    </div>
                                    <span
                                        className={badge.isBoarding ? 'badge-boarding-pulsing' : ''}
                                        aria-label={badge.ariaLabel}
                                        style={{
                                            padding: '0.35rem 0.85rem',
                                            borderRadius: '9999px',
                                            fontSize: '0.875rem',
                                            fontWeight: '600',
                                            display: 'inline-block',
                                            ...badge.style,
                                        }}
                                    >
                                        {badge.label}
                                    </span>
                                </div>

                                {/* Delay Reason / Notice Banner */}
                                {isDelayed && (
                                    <div
                                        role="alert"
                                        style={{
                                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                            border: '1px solid rgba(245, 158, 11, 0.3)',
                                            color: '#fbbf24',
                                            borderRadius: '8px',
                                            padding: '0.75rem 1rem',
                                            marginBottom: '1.25rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            fontSize: '0.875rem',
                                        }}
                                    >
                                        <span aria-hidden="true">⚠️</span>
                                        <span>
                                            {flight.delayReason
                                                ? `Delayed: ${flight.delayReason}`
                                                : 'This flight is experiencing delays.'}
                                        </span>
                                    </div>
                                )}

                                {/* Progress Bar */}
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '0.5rem',
                                        }}
                                    >
                                        <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                            {flight.fromAirportCode}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: '0.875rem',
                                                color: 'rgba(255, 255, 255, 0.6)',
                                            }}
                                        >
                                            {flight.durationFormatted}
                                        </span>
                                        <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                            {flight.toAirportCode}
                                        </span>
                                    </div>
                                    <div
                                        role="progressbar"
                                        aria-valuenow={progress}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label={`Flight progress from ${flight.fromAirportCode} to ${flight.toAirportCode}`}
                                        style={{
                                            height: '8px',
                                            width: '100%',
                                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                            borderRadius: '9999px',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: '100%',
                                                width: `${progress}%`,
                                                backgroundColor:
                                                    flight.phase === 'CANCELLED'
                                                        ? '#ef4444'
                                                        : flight.phase === 'DELAYED'
                                                        ? '#f59e0b'
                                                        : '#c084fc',
                                                borderRadius: '9999px',
                                                transition: 'width 0.5s ease',
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Departure & Arrival Panels */}
                                <div
                                    style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '1.5rem',
                                        marginBottom: '1.5rem',
                                    }}
                                >
                                    {/* Departure Panel */}
                                    <div
                                        style={{
                                            flex: '1 1 240px',
                                            minWidth: 0,
                                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                            padding: '1rem',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(255, 255, 255, 0.05)',
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '0.75rem',
                                                textTransform: 'uppercase',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                                fontWeight: '600',
                                                letterSpacing: '0.05em',
                                                marginBottom: '0.25rem',
                                            }}
                                        >
                                            Departure
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '1.1rem',
                                                fontWeight: 'bold',
                                                color: '#fff',
                                                marginBottom: '0.5rem',
                                            }}
                                        >
                                            {flight.from} ({flight.fromAirportCode})
                                        </div>
                                        <div style={{ fontSize: '0.95rem', color: '#fff', marginBottom: '0.25rem' }}>
                                            Scheduled: <strong>{flight.departure.time} {flight.departure.zoneLabel}</strong>
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '0.5rem' }}>
                                            {flight.departure.readableDate}
                                        </div>

                                        {actualDepFormatted ? (
                                            <div style={{ fontSize: '0.875rem', color: '#60a5fa', marginBottom: '0.5rem' }}>
                                                Actual: {actualDepFormatted.time} {actualDepFormatted.zoneLabel}
                                            </div>
                                        ) : estDepFormatted ? (
                                            <div style={{ fontSize: '0.875rem', color: '#fbbf24', marginBottom: '0.5rem' }}>
                                                Estimated: {estDepFormatted.time} {estDepFormatted.zoneLabel}
                                            </div>
                                        ) : null}

                                        <div
                                            style={{
                                                display: 'flex',
                                                gap: '1rem',
                                                fontSize: '0.875rem',
                                                color: 'rgba(255, 255, 255, 0.8)',
                                                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                                                paddingTop: '0.5rem',
                                                marginTop: '0.5rem',
                                            }}
                                        >
                                            <span>Terminal {flight.gates.departureTerminal}</span>
                                            <span>Gate {flight.gates.departureGate}</span>
                                        </div>
                                    </div>

                                    {/* Arrival Panel */}
                                    <div
                                        style={{
                                            flex: '1 1 240px',
                                            minWidth: 0,
                                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                            padding: '1rem',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(255, 255, 255, 0.05)',
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '0.75rem',
                                                textTransform: 'uppercase',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                                fontWeight: '600',
                                                letterSpacing: '0.05em',
                                                marginBottom: '0.25rem',
                                            }}
                                        >
                                            Arrival
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '1.1rem',
                                                fontWeight: 'bold',
                                                color: '#fff',
                                                marginBottom: '0.5rem',
                                            }}
                                        >
                                            {flight.to} ({flight.toAirportCode})
                                        </div>
                                        <div style={{ fontSize: '0.95rem', color: '#fff', marginBottom: '0.25rem' }}>
                                            Scheduled:{' '}
                                            <strong>
                                                {flight.arrival
                                                    ? `${flight.arrival.time} ${flight.arrival.zoneLabel}`
                                                    : 'N/A'}
                                            </strong>
                                            {flight.arrival && flight.arrival.dayOffset === 1
                                                ? ' (+1 day)'
                                                : flight.arrival && flight.arrival.dayOffset > 1
                                                ? ` (+${flight.arrival.dayOffset} days)`
                                                : ''}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '0.5rem' }}>
                                            {flight.arrival ? flight.arrival.readableDate : ''}
                                        </div>

                                        {actualArrFormatted ? (
                                            <div style={{ fontSize: '0.875rem', color: '#c4b5fd', marginBottom: '0.5rem' }}>
                                                Actual: {actualArrFormatted.time} {actualArrFormatted.zoneLabel}
                                            </div>
                                        ) : estArrFormatted ? (
                                            <div style={{ fontSize: '0.875rem', color: '#fbbf24', marginBottom: '0.5rem' }}>
                                                Estimated: {estArrFormatted.time} {estArrFormatted.zoneLabel}
                                            </div>
                                        ) : null}

                                        <div
                                            style={{
                                                display: 'flex',
                                                gap: '1rem',
                                                fontSize: '0.875rem',
                                                color: 'rgba(255, 255, 255, 0.8)',
                                                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                                                paddingTop: '0.5rem',
                                                marginTop: '0.5rem',
                                            }}
                                        >
                                            <span>Terminal {flight.gates.arrivalTerminal}</span>
                                            <span>Gate {flight.gates.arrivalGate}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer: Duration & Book Link */}
                                <div
                                    style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        justifyContent: 'flex-end',
                                        alignItems: 'center',
                                        gap: '1rem',
                                        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                                        paddingTop: '1rem',
                                    }}
                                >
                                    <Link
                                        href={`/book?flight=${flight.id}`}
                                        style={{
                                            padding: '0.5rem 1.25rem',
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(192, 132, 252, 0.2)',
                                            color: '#c084fc',
                                            fontWeight: '600',
                                            fontSize: '0.875rem',
                                            textDecoration: 'none',
                                            border: '1px solid rgba(192, 132, 252, 0.4)',
                                            transition: 'background-color 0.2s',
                                        }}
                                    >
                                        Book This Flight
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : hasSearched ? (
                <div
                    style={{
                        padding: '3rem 1.5rem',
                        textAlign: 'center',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '16px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        color: 'rgba(255, 255, 255, 0.6)',
                    }}
                >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>No flights found</div>
                    <p style={{ fontSize: '0.95rem', margin: 0 }}>
                        No flights matched your search criteria within {coverage}. Please check the flight number or route.
                    </p>
                </div>
            ) : null}
        </div>
    );
}
