"use client"

import * as React from 'react'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { searchFlightsAction } from '@/app/actions'
import { Flight } from '@prisma/client'

interface FlightBookingFormProps {
    routes?: { from: string; to: string }[];
}

const FlightBookingForm: React.FC<FlightBookingFormProps> = ({ routes = [] }) => {
    // Origins are the distinct departure cities; destinations depend on the
    // selected origin so only reachable routes can be chosen.
    const origins = useMemo(() => Array.from(new Set(routes.map((r) => r.from))), [routes]);
    const [fromLocation, setFromLocation] = useState(origins[0] ?? '');
    const destinations = useMemo(
        () => routes.filter((r) => r.from === fromLocation).map((r) => r.to),
        [routes, fromLocation]
    );
    const [toLocation, setToLocation] = useState(destinations[0] ?? '');
    const [departureDate, setDepartureDate] = useState<string>('');
    const [returnDate, setReturnDate] = useState<string>('');
    const [flightClass, setFlightClass] = useState('economy');
    const [isOneWay, setIsOneWay] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<Flight[] | null>(null);
    const [bookingState, setBookingState] = useState<{ status: 'idle' | 'booking' | 'success' | 'error', message?: string, flightId?: number }>({ status: 'idle' });

    // Interactive Filters & Sorting States
    const [sortBy, setSortBy] = useState('price-asc');
    const [maxPrice, setMaxPrice] = useState<number>(0);
    const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);

    const handleTripTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setIsOneWay(e.target.value === 'one-way');
        if (e.target.value === 'one-way') {
            setReturnDate(''); // Clear return date when switching to one-way
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSearching(true);
        setSearchResults(null);
        setBookingState({ status: 'idle' });

        try {
            const results = await searchFlightsAction(fromLocation, toLocation, departureDate);
            setSearchResults(results);
        } catch (error) {
            console.error(error);
        } finally {
            setIsSearching(false);
        }
    };

    // When the origin changes, keep the destination valid for the new origin.
    useEffect(() => {
        if (!destinations.includes(toLocation)) {
            setToLocation(destinations[0] ?? '');
        }
    }, [destinations, toLocation]);

    useEffect(() => {
        const today = new Date();
        const departure = new Date(today);
        departure.setDate(today.getDate() + 7);
        const returnD = new Date(departure);
        returnD.setDate(departure.getDate() + 7);

        setDepartureDate(departure.toISOString().split('T')[0]);
        setReturnDate(returnD.toISOString().split('T')[0]);
    }, []);

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
            <form onSubmit={handleSearch}>
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
                    <select id="from" name="from" value={fromLocation} onChange={e => setFromLocation(e.target.value)}>
                        {origins.map((loc) => (
                            <option key={loc} value={loc}>{loc}</option>
                        ))}
                    </select>
                </div>

                <div className="fields-container">
                    <label htmlFor="to">To</label>
                    <select id="to" name="to" value={toLocation} onChange={e => setToLocation(e.target.value)}>
                        {destinations.map((loc) => (
                            <option key={loc} value={loc}>{loc}</option>
                        ))}
                    </select>
                </div>

                <div className="date-container">
                    <div>
                        <label htmlFor="depart">Depart</label>
                        <input type="date" id="depart" name="depart" value={departureDate} onChange={e => setDepartureDate(e.target.value)} />
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
                            value={returnDate}
                            onChange={(e) => setReturnDate(e.target.value)}
                            disabled={isOneWay}
                        />
                    </div>
                </div>

                <div className="fields-container">
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
        <div className="page-container home" style={{ minHeight: '100vh', padding: '40px 20px' }}>
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
                                    No flights found for this route. Try a different origin or destination.
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
                                    <h2 className="text-2xl font-bold" style={{ fontSize: '1.25rem', color: '#c084fc', margin: 0, display: 'inline-block' }}>Available Flights</h2>
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
                                        <div key={flight.id} className="hover:bg-white/5 transition-colors" style={{
                                            border: '1px solid rgba(255, 255, 255, 0.06)',
                                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                            borderRadius: '12px',
                                            padding: '16px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            backdropFilter: 'blur(10px)',
                                            WebkitBackdropFilter: 'blur(10px)',
                                            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                        }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#c084fc' }}>{flight.airline}</span>
                                                <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                <span suppressHydrationWarning style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>
                                                    {new Date(flight.departureDate).toLocaleDateString()}
                                                </span>
                                                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.from}</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.3)' }}>------&gt;</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                <span suppressHydrationWarning style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>
                                                    {flight.returnDate ? new Date(flight.returnDate).toLocaleDateString() : 'One Way'}
                                                </span>
                                                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.to}</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'end' }}>
                                                <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34d399' }}>{flight.price}</span>
                                                <Link
                                                    href={`/book/${flight.id}`}
                                                    style={{ 
                                                        backgroundColor: '#8b5cf6', 
                                                        color: 'white',
                                                        padding: '6px 16px',
                                                        borderRadius: '6px',
                                                        fontSize: '0.875rem',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        fontWeight: '600',
                                                        textDecoration: 'none',
                                                        marginTop: '8px',
                                                        display: 'block',
                                                        textAlign: 'center'
                                                    }}>
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
                        </div>
                    </>
                )}

                {bookingState.status === 'success' && (
                    <div style={{ marginTop: '2rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', color: '#10b981', padding: '12px 16px', borderRadius: '8px', width: '100%', maxWidth: '800px', textAlign: 'center' }} role="alert">
                        <span>{bookingState.message}</span>
                    </div>
                )}
                {bookingState.status === 'error' && (
                    <div style={{ marginTop: '2rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '12px 16px', borderRadius: '8px', width: '100%', maxWidth: '800px', textAlign: 'center' }} role="alert">
                        <span>{bookingState.message}</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export default FlightBookingForm