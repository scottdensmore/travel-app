"use client"

import * as React from 'react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { bookFlightAction, searchFlightsAction } from '@/app/actions'
import { Flight } from '@prisma/client'

const FlightBookingForm: React.FC = () => {
    const [departureDate, setDepartureDate] = useState<string>('');
    const [returnDate, setReturnDate] = useState<string>('');
    const [fromLocation, setFromLocation] = useState('SFO');
    const [toLocation, setToLocation] = useState('NYC');
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
            const results = await searchFlightsAction(fromLocation, toLocation);
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
                                    <option value="SFO">San Francisco (SFO)</option>
                                    <option value="NYC">New York City (NYC)</option>
                                    <option value="LAX">Los Angeles (LAX)</option>
                                    <option value="CHI">Chicago (CHI)</option>
                                    <option value="ATL">Atlanta (ATL)</option>
                                    <option value="DFW">Dallas/Fort Worth (DFW)</option>
                                    <option value="DEN">Denver (DEN)</option>
                                    <option value="SEA">Seattle (SEA)</option>
                                    <option value="LAS">Las Vegas (LAS)</option>
                                    <option value="MIA">Miami (MIA)</option>
                                    <option value="BOS">Boston (BOS)</option>
                                    <option value="PHX">Phoenix (PHX)</option>
                                    <option value="IAH">Houston (IAH)</option>
                                </select>
                            </div>

                            <div className="fields-container">
                                <label htmlFor="to">To</label>
                                <select id="to" name="to" value={toLocation} onChange={e => setToLocation(e.target.value)}>
                                    <option value="NYC">New York City (NYC)</option>
                                    <option value="LAX">Los Angeles (LAX)</option>
                                    <option value="CHI">Chicago (CHI)</option>
                                    <option value="ATL">Atlanta (ATL)</option>
                                    <option value="DFW">Dallas/Fort Worth (DFW)</option>
                                    <option value="DEN">Denver (DEN)</option>
                                    <option value="SFO">San Francisco (SFO)</option>
                                    <option value="SEA">Seattle (SEA)</option>
                                    <option value="LAS">Las Vegas (LAS)</option>
                                    <option value="MIA">Miami (MIA)</option>
                                    <option value="BOS">Boston (BOS)</option>
                                    <option value="PHX">Phoenix (PHX)</option>
                                    <option value="IAH">Houston (IAH)</option>
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
                    {searchResults && (
                        <div className="mt-8 bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
                            <h2 className="text-2xl font-bold mb-4 text-gray-800">Available Flights</h2>
                            <div className="space-y-4">
                                {searchResults.map((flight) => (
                                    <div key={flight.id} className="border border-gray-200 rounded-md p-4 flex justify-between items-center hover:bg-gray-50 transition-colors">
                                        <div className="flex flex-col">
                                            <span className="text-lg font-semibold text-blue-600">{flight.airline}</span>
                                            <span className="text-sm text-gray-500">{flight.flightNumber}</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-xl font-bold text-gray-800">{new Date(flight.departureDate).toLocaleDateString()}</span>
                                            <span className="text-xs text-gray-400">{flight.from}</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-sm text-gray-500">------&gt;</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-xl font-bold text-gray-800">{flight.returnDate ? new Date(flight.returnDate).toLocaleDateString() : 'One Way'}</span>
                                            <span className="text-xs text-gray-400">{flight.to}</span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-2xl font-bold text-green-600">{flight.price}</span>
                                            <button
                                                onClick={() => handleBookFlight(flight)}
                                                disabled={bookingState.status === 'booking' && bookingState.flightId === flight.id}
                                                className="mt-2 text-white px-4 py-1 rounded text-sm disabled:opacity-50"
                                                style={{ backgroundColor: '#2171E5' }}>
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