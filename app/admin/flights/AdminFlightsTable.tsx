"use client"

import React, { useState } from 'react';
import FlightStatusSelector from './FlightStatusSelector';

interface Passenger {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date | string;
    passportNumber: string;
    gender: string;
    seatNumber: string;
    cabinClass: string;
}

interface Booking {
    id: number;
    createdAt: Date | string;
    status: string;
    totalPrice: string;
    passengers: Passenger[];
}

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    price: string;
    status: string;
    bookings: Booking[];
}

interface AdminFlightsTableProps {
    initialFlights: Flight[];
}

export default function AdminFlightsTable({ initialFlights }: AdminFlightsTableProps) {
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);

    const manifestPassengers = selectedFlight
        ? selectedFlight.bookings.flatMap(b =>
              b.passengers.map(p => ({ ...p, bookingStatus: b.status }))
          )
        : [];

    return (
        <>
            <div className="admin-card">
                <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem 0', color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                    Active occurrences (Next 7 Days)
                </h2>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Flight</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Route</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Departure Date</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Price</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Bookings (Active/Cancelled)</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Occupancy (Seats Booked)</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase' }}>Live Status Monitor</th>
                                <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {initialFlights.map(flight => {
                                const activeBookings = flight.bookings.filter(b => b.status !== 'CANCELLED').length;
                                const cancelledBookings = flight.bookings.filter(b => b.status === 'CANCELLED').length;
                                
                                const activePassengersCount = flight.bookings
                                    .filter(b => b.status !== 'CANCELLED')
                                    .flatMap(b => b.passengers).length;
                                const occupancyPercentage = ((activePassengersCount / 180) * 100).toFixed(1);

                                return (
                                    <tr key={flight.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                        <td style={{ padding: '12px', fontSize: '0.9rem' }}>
                                            <div style={{ fontWeight: 'bold', color: '#fff' }}>{flight.airline}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>{flight.flightNumber}</div>
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                            {flight.from} → {flight.to}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#fff' }}>
                                            <div suppressHydrationWarning>{new Date(flight.departureDate).toLocaleDateString()}</div>
                                            <div suppressHydrationWarning style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                                                {new Date(flight.departureDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#34d399', fontWeight: 'bold' }}>
                                            {flight.price}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem' }}>
                                            <span style={{ color: '#10b981', fontWeight: 'bold' }}>{activeBookings} Active</span>
                                            {cancelledBookings > 0 && (
                                                <span style={{ color: '#ef4444', fontSize: '0.8rem', marginLeft: '8px' }}>({cancelledBookings} Cancelled)</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '0.9rem', color: '#e5e7eb' }}>
                                            <div style={{ fontWeight: '500' }}>{activePassengersCount} / 180</div>
                                            <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>{occupancyPercentage}% full</div>
                                        </td>
                                        <td style={{ padding: '12px' }}>
                                            <FlightStatusSelector id={flight.id} currentStatus={flight.status} />
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            <button
                                                onClick={() => setSelectedFlight(flight)}
                                                style={{
                                                    color: '#fff',
                                                    border: 'none',
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    transition: 'all 0.2s'
                                                }}
                                                className="bg-[#8b5cf6] hover:bg-purple-700"
                                            >
                                                Manifest
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {initialFlights.length === 0 && (
                                <tr>
                                    <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                        No active flight instances generated for the next 7 days.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* PASSENGER MANIFEST MODAL */}
            {selectedFlight && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    backdropFilter: 'blur(16px)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem'
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #131127 0%, #200f28 100%)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '24px',
                        padding: '2rem',
                        maxWidth: '850px',
                        width: '100%',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        color: '#fff',
                        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)'
                    }}>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px' }}>
                            <div>
                                <h2 style={{ fontSize: '1.5rem', color: '#c084fc', margin: 0, fontWeight: 'bold' }}>
                                    Passenger Manifest
                                </h2>
                                <p suppressHydrationWarning style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.5)', margin: '4px 0 0 0' }}>
                                    {selectedFlight.airline} {selectedFlight.flightNumber} | {selectedFlight.from} → {selectedFlight.to} | {new Date(selectedFlight.departureDate).toLocaleString()}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedFlight(null)}
                                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: '1.5rem', cursor: 'pointer' }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Manifest Stats Summary Card */}
                        <div style={{ 
                            display: 'flex', 
                            gap: '1.5rem', 
                            marginBottom: '1.5rem', 
                            background: 'rgba(255, 255, 255, 0.02)', 
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            padding: '1rem',
                            borderRadius: '12px'
                        }}>
                            <div>
                                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>Total Booked</span>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38bdf8' }}>
                                    {manifestPassengers.length}
                                </div>
                            </div>
                            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '1.5rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>Confirmed</span>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#10b981' }}>
                                    {manifestPassengers.filter(p => p.bookingStatus !== 'CANCELLED').length}
                                </div>
                            </div>
                            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '1.5rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>Cancelled</span>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#ef4444' }}>
                                    {manifestPassengers.filter(p => p.bookingStatus === 'CANCELLED').length}
                                </div>
                            </div>
                        </div>

                        {/* Passengers Table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                                        <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase' }}>Passenger</th>
                                        <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase' }}>Gender</th>
                                        <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase' }}>DOB</th>
                                        <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase' }}>Passport</th>
                                        <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase' }}>Class / Seat</th>
                                        <th style={{ padding: '8px 12px', color: '#a78bfa', fontSize: '0.8rem', textTransform: 'uppercase' }}>Booking Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {manifestPassengers.length > 0 ? (
                                        manifestPassengers.map(passenger => {
                                            const isCancelled = passenger.bookingStatus === 'CANCELLED';
                                            return (
                                                <tr key={passenger.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                                    <td style={{ padding: '10px 12px', fontSize: '0.9rem', color: '#fff', fontWeight: 'bold' }}>
                                                        {passenger.firstName} {passenger.lastName}
                                                    </td>
                                                    <td style={{ padding: '10px 12px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                                                        {passenger.gender}
                                                    </td>
                                                    <td suppressHydrationWarning style={{ padding: '10px 12px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                                                        {new Date(passenger.dateOfBirth).toLocaleDateString()}
                                                    </td>
                                                    <td style={{ padding: '10px 12px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                                                        {passenger.passportNumber}
                                                    </td>
                                                    <td style={{ padding: '10px 12px', fontSize: '0.85rem' }}>
                                                        <div>{passenger.cabinClass}</div>
                                                        <div style={{ color: isCancelled ? '#ef4444' : '#34d399', fontWeight: 'bold', fontSize: '0.75rem' }}>
                                                            {passenger.seatNumber.startsWith('CANCELLED') ? 'Released' : `Seat ${passenger.seatNumber}`}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <span style={{
                                                            color: isCancelled ? '#ef4444' : '#10b981',
                                                            fontWeight: 'bold',
                                                            fontSize: '0.8rem'
                                                        }}>
                                                            {isCancelled ? 'Cancelled' : 'Confirmed'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    ) : (
                                        <tr>
                                            <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)' }}>
                                                No passengers booked on this occurrence.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '1rem' }}>
                            <button
                                onClick={() => setSelectedFlight(null)}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    color: '#fff',
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
