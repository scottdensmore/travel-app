"use client"

import * as React from 'react'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { bookFlightAction, searchFlightsAction } from '@/app/actions'
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

    const handleBookFlight = async (flight: Flight) => {
        setBookingState({ status: 'booking', flightId: flight.id });
        try {
            await bookFlightAction({ flightId: flight.id });
            setBookingState({ status: 'success', message: `Successfully booked flight ${flight.flightNumber}! Check your profile.` });
            setSearchResults(null); // Clear search after booking
        } catch (error) {
            console.error(error);
            setBookingState({ status: 'error', message: 'Failed to book flight. Please try again later.' });
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

    return (

        <div className="page-container home">
            <div className="content">
                <div className="hero-text">
                    <h1>Where Your Journey Takes Flight</h1>
                </div>
                <div className="search-trip">
                    <div className="form">
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
                    </div>
                    {searchResults && searchResults.length === 0 && (
                        <div className="mt-8 max-w-4xl mx-auto text-center" style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '16px',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            padding: '24px',
                            color: 'rgba(255, 255, 255, 0.6)'
                        }}>
                            No flights found for this route. Try a different origin or destination.
                        </div>
                    )}
                    {searchResults && searchResults.length > 0 && (
                        <div className="mt-8 max-w-4xl mx-auto" style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '16px',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
                            padding: '24px'
                        }}>
                            <h2 className="text-2xl font-bold mb-4" style={{ color: '#c084fc' }}>Available Flights</h2>
                            <div className="space-y-4" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {searchResults.map((flight) => (
                                    <div key={flight.id} className="hover:bg-white/5 transition-colors" style={{
                                        border: '1px solid rgba(255, 255, 255, 0.06)',
                                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                        borderRadius: '12px',
                                        padding: '16px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <div className="flex flex-col" style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#c084fc' }}>{flight.airline}</span>
                                            <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</span>
                                        </div>
                                        <div className="flex flex-col items-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>{new Date(flight.departureDate).toLocaleDateString()}</span>
                                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.from}</span>
                                        </div>
                                        <div className="flex flex-col items-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.3)' }}>------&gt;</span>
                                        </div>
                                        <div className="flex flex-col items-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff' }}>{flight.returnDate ? new Date(flight.returnDate).toLocaleDateString() : 'One Way'}</span>
                                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.to}</span>
                                        </div>
                                        <div className="flex flex-col items-end" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34d399' }}>{flight.price}</span>
                                            <button
                                                onClick={() => handleBookFlight(flight)}
                                                disabled={bookingState.status === 'booking' && bookingState.flightId === flight.id}
                                                className="mt-2 text-white px-4 py-1 rounded text-sm disabled:opacity-50"
                                                style={{ 
                                                    backgroundColor: '#8b5cf6', 
                                                    color: 'white',
                                                    padding: '6px 16px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.875rem',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    fontWeight: '600'
                                                }}>
                                                {bookingState.status === 'booking' && bookingState.flightId === flight.id ? 'Booking...' : 'Book Now'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {bookingState.status === 'success' && (
                        <div className="mt-8 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative max-w-4xl mx-auto" role="alert">
                            <span className="block sm:inline">{bookingState.message}</span>
                        </div>
                    )}
                    {bookingState.status === 'error' && (
                        <div className="mt-8 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative max-w-4xl mx-auto" role="alert">
                            <span className="block sm:inline">{bookingState.message}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default FlightBookingForm