"use client"

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import PointsActivityTable from "@/components/ui/pointsActivityTable";
import NextStatusChart from "@/components/ui/charts/nextStatusChart";
import PointsHistoryChart from "@/components/ui/charts/pointsHistoryChart";
import { cancelBookingAction, deleteReviewAction, toggleFavoriteCityGuideAction, changeBookingSeatsAction, getOccupiedSeatsAction } from '@/app/actions';
import { PointsActivityDisplayData } from '@/lib/types/PointsActivity';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    returnDate: Date | string | null;
    price: string;
}

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
    status: string; // "CONFIRMED" or "CANCELLED"
    totalPrice: string;
    flightId: number | null;
    flight: Flight | null;
    passengers: Passenger[];
}

interface CityGuide {
    id: number;
    city: string;
    country: string;
    description: string;
    coverImage: string | null;
}

interface UserFavorite {
    id: string;
    cityGuideId: number;
    cityGuide: CityGuide;
}

interface Review {
    id: string;
    content: string;
    rating: number;
    cityGuide: CityGuide;
    createdAt: Date | string;
}

interface ProfileClientProps {
    userName: string;
    userAvatar: string;
    currentStatus: string;
    currentPoints: number;
    bookings: Booking[];
    favorites: UserFavorite[];
    reviews: Review[];
    activityData: PointsActivityDisplayData[];
    monthlyHistory: PointsActivityDisplayData[];
}

export default function ProfileClient({
    userName,
    userAvatar,
    currentStatus,
    currentPoints,
    bookings,
    favorites,
    reviews,
    activityData,
    monthlyHistory
}: ProfileClientProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    // Modal state
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
    const [modalOccupiedSeats, setModalOccupiedSeats] = useState<string[]>([]);
    const [passengerSeats, setPassengerSeats] = useState<{ [passengerId: string]: string }>({});
    const [activePassengerIdx, setActivePassengerIdx] = useState<number>(0);
    const [modalError, setModalError] = useState<string | null>(null);
    const [isSavingSeats, setIsSavingSeats] = useState<boolean>(false);

    useEffect(() => {
        if (selectedBooking && selectedBooking.flightId) {
            getOccupiedSeatsAction(selectedBooking.flightId)
                .then(seats => {
                    setModalOccupiedSeats(seats);
                })
                .catch(() => {
                    setModalOccupiedSeats([]);
                });
            
            const initial: { [key: string]: string } = {};
            selectedBooking.passengers.forEach(p => {
                initial[p.id] = p.seatNumber;
            });
            setPassengerSeats(initial);
            setActivePassengerIdx(0);
            setModalError(null);
        }
    }, [selectedBooking]);

    const handleCancelBooking = (bookingId: number, flightNumber: string) => {
        if (!confirm(`Are you sure you want to cancel booking for flight ${flightNumber}? This will release your seats.`)) return;

        startTransition(async () => {
            try {
                await cancelBookingAction(bookingId);
                router.refresh();
            } catch (error) {
                alert('Failed to cancel booking. Please try again.');
            }
        });
    };

    const handleDeleteReview = (reviewId: string) => {
        if (!confirm('Are you sure you want to delete this review?')) return;

        startTransition(async () => {
            try {
                await deleteReviewAction(reviewId);
                router.refresh();
            } catch (error) {
                alert('Failed to delete review. Please try again.');
            }
        });
    };

    const handleUnfavorite = (cityId: number, cityName: string) => {
        startTransition(async () => {
            try {
                await toggleFavoriteCityGuideAction(cityId);
                router.refresh();
            } catch (error) {
                alert('Failed to update favorite. Please try again.');
            }
        });
    };

    const handleSaveSeats = async () => {
        if (!selectedBooking) return;
        
        for (const p of selectedBooking.passengers) {
            if (!passengerSeats[p.id]) {
                setModalError(`Please select a seat for ${p.firstName} ${p.lastName}`);
                return;
            }
        }

        setIsSavingSeats(true);
        setModalError(null);

        try {
            const seatChanges = Object.keys(passengerSeats).map(pid => ({
                passengerId: pid,
                seatNumber: passengerSeats[pid]
            }));

            await changeBookingSeatsAction(selectedBooking.id, seatChanges);
            setSelectedBooking(null);
            router.refresh();
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to update seats. Please try again.';
            setModalError(msg);
        } finally {
            setIsSavingSeats(false);
        }
    };

    const getRowsForClass = (cabinClass: string) => {
        switch (cabinClass) {
            case 'FIRST': return [1, 2, 3];
            case 'BUSINESS': return [4, 5, 6];
            case 'PREMIUM_ECONOMY': return [7, 8, 9, 10];
            case 'ECONOMY':
            default:
                return Array.from({ length: 20 }, (_, i) => i + 11);
        }
    };

    const isSeatOccupied = (seat: string) => {
        if (!selectedBooking) return false;
        const activePassenger = selectedBooking.passengers[activePassengerIdx];
        
        // Find seats currently selected by OTHER passengers in this booking in the modal
        const selectedByOthers = Object.keys(passengerSeats)
            .filter(pid => pid !== activePassenger?.id)
            .map(pid => passengerSeats[pid]);
            
        // Exclude current booking's passengers' original seats from the general occupied list
        const occupiedByOthersOnFlight = modalOccupiedSeats.filter(
            s => !selectedBooking.passengers.some(p => p.seatNumber === s)
        );
        
        return occupiedByOthersOnFlight.includes(seat) || selectedByOthers.includes(seat);
    };

    return (
        <div className="page-container profile">
            <div className="sidebar-menu">
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <img src={userAvatar} className="user-avatar" alt="Avatar" style={{ display: 'inline-block' }} />
                    <h3 style={{ margin: '1rem 0 0.5rem' }}>{userName}</h3>
                    <p style={{ margin: '0.25rem 0' }}><strong>Current Status:</strong> {currentStatus}</p>
                    <p style={{ margin: '0.25rem 0' }}><strong>Status Points:</strong> {currentPoints.toLocaleString()}</p>
                </div>

                <div style={{ marginBottom: '2rem' }}>
                    <NextStatusChart points={currentPoints} />
                </div>
                <div>
                    <PointsHistoryChart chartData={monthlyHistory} />
                </div>
            </div>

            <div className="content">
                {/* Bookings Section */}
                <div className="profile-card">
                    <h2 className="text-2xl font-bold mb-4">My Bookings</h2>
                    {bookings.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left">
                                <thead>
                                    <tr className="border-b">
                                        <th className="pb-2">Flight</th>
                                        <th className="pb-2">Route</th>
                                        <th className="pb-2">Departure</th>
                                        <th className="pb-2">Price</th>
                                        <th className="pb-2">Status</th>
                                        <th className="pb-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bookings.map((booking) => {
                                        const flight = booking.flight;
                                        const isCancelled = booking.status === 'CANCELLED';
                                        return (
                                            <tr key={booking.id} className="border-b">
                                                <td className="py-2">
                                                    <div>{flight ? `${flight.airline} ${flight.flightNumber}` : '—'}</div>
                                                    {booking.passengers && booking.passengers.length > 0 && (
                                                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                                                            {booking.passengers.map(p => `${p.firstName} (${p.seatNumber.startsWith('CANCELLED') ? 'Released' : p.seatNumber})`).join(', ')}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-2">{flight ? `${flight.from} → ${flight.to}` : '—'}</td>
                                                <td className="py-2">{flight ? new Date(flight.departureDate).toLocaleDateString() : '—'}</td>
                                                <td className="py-2">{booking.totalPrice || flight?.price || '—'}</td>
                                                <td className="py-2">
                                                    <span style={{ 
                                                        color: isCancelled ? '#ef4444' : '#10b981', 
                                                        fontWeight: 'bold',
                                                        fontSize: '0.85rem'
                                                    }}>
                                                        {isCancelled ? 'Cancelled' : 'Confirmed'}
                                                    </span>
                                                </td>
                                                <td className="py-2 text-right">
                                                    {!isCancelled && (
                                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                            <button
                                                                onClick={() => setSelectedBooking(booking)}
                                                                disabled={isPending}
                                                                style={{ 
                                                                    backgroundColor: '#8b5cf6', 
                                                                    color: 'white', 
                                                                    padding: '4px 8px', 
                                                                    borderRadius: '4px', 
                                                                    fontSize: '12px', 
                                                                    height: 'auto', 
                                                                    width: 'auto',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                Change Seats
                                                            </button>
                                                            <button
                                                                onClick={() => handleCancelBooking(booking.id, flight?.flightNumber || '')}
                                                                disabled={isPending}
                                                                style={{ 
                                                                    backgroundColor: '#ef4444', 
                                                                    color: 'white', 
                                                                    padding: '4px 8px', 
                                                                    borderRadius: '4px', 
                                                                    fontSize: '12px', 
                                                                    height: 'auto', 
                                                                    width: 'auto',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-gray-500 italic">You have no bookings yet.</p>
                    )}
                </div>

                {/* Favorites Section */}
                <div className="profile-card mt-8">
                    <h2 className="text-2xl font-bold mb-4">Favorite City Guides</h2>
                    {favorites.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
                            {favorites.map((fav) => (
                                <div key={fav.id} className="border rounded-lg p-4 bg-gray-50 flex flex-col justify-between" style={{ border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                    <div>
                                        {fav.cityGuide.coverImage && (
                                            <img src={fav.cityGuide.coverImage} alt={fav.cityGuide.city} style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '4px', marginBottom: '8px' }} />
                                        )}
                                        <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: '#fff' }}>{fav.cityGuide.city}</h3>
                                        <p style={{ margin: '0 0 12px', color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>{fav.cityGuide.country}</p>
                                    </div>
                                    <button
                                        onClick={() => handleUnfavorite(fav.cityGuideId, fav.cityGuide.city)}
                                        disabled={isPending}
                                        aria-label={`Unfavorite ${fav.cityGuide.city}`}
                                        style={{ 
                                            background: 'none', 
                                            border: '1px solid rgba(255, 255, 255, 0.2)', 
                                            color: '#e5e7eb', 
                                            padding: '4px 8px', 
                                            borderRadius: '4px', 
                                            fontSize: '12px', 
                                            height: 'auto', 
                                            width: '100%',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        💔 Unfavorite
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 italic">No favorite city guides added yet.</p>
                    )}
                </div>

                {/* Reviews Section */}
                <div className="profile-card mt-8">
                    <h2 className="text-2xl font-bold mb-4">My Reviews</h2>
                    {reviews.length > 0 ? (
                        <div className="space-y-4" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {reviews.map((rev) => (
                                <div key={rev.id} className="border-b pb-4 flex justify-between items-start" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '4px' }}>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>{rev.cityGuide.city}</h4>
                                            <span style={{ color: '#f59e0b' }}>{'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}</span>
                                        </div>
                                        <p style={{ margin: '4px 0', fontSize: '0.95rem', color: 'rgba(255, 255, 255, 0.8)' }}>{rev.content}</p>
                                        <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.4)' }}>{new Date(rev.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteReview(rev.id)}
                                        disabled={isPending}
                                        aria-label="Delete review"
                                        style={{ 
                                            backgroundColor: 'transparent', 
                                            border: 'none', 
                                            color: '#ef4444', 
                                            padding: '4px', 
                                            fontSize: '14px', 
                                            height: 'auto', 
                                            width: 'auto',
                                            cursor: 'pointer',
                                            fontWeight: 'bold'
                                        }}
                                        title="Delete Review"
                                    >
                                        🗑️ Delete
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 italic">You have not written any reviews yet.</p>
                    )}
                </div>

                <div className="profile-card mt-8">
                    <PointsActivityTable activityData={activityData} />
                </div>
            </div>

            {/* SEAT EDITOR MODAL */}
            {selectedBooking && selectedBooking.passengers && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    backdropFilter: 'blur(10px)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem'
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '24px',
                        padding: '2.5rem',
                        maxWidth: '800px',
                        width: '100%',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        color: '#fff',
                        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', color: '#c084fc', margin: 0, fontWeight: 'bold' }}>Change Seats</h2>
                            <button 
                                onClick={() => setSelectedBooking(null)}
                                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: '1.5rem', cursor: 'pointer' }}
                            >
                                ✕
                            </button>
                        </div>

                        {modalError && (
                            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                ⚠️ {modalError}
                            </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
                            {/* Left panel: Passengers list */}
                            <div style={{ flex: '1 1 200px' }}>
                                <h3 style={{ fontSize: '0.95rem', color: '#a78bfa', marginBottom: '0.75rem' }}>Passengers</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {selectedBooking.passengers.map((p, idx) => (
                                        <div 
                                            key={p.id}
                                            onClick={() => setActivePassengerIdx(idx)}
                                            style={{
                                                padding: '10px',
                                                borderRadius: '8px',
                                                border: activePassengerIdx === idx ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.08)',
                                                background: activePassengerIdx === idx ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.01)',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{p.firstName} {p.lastName}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                                                Seat: <span style={{ color: '#34d399', fontWeight: 'bold' }}>{passengerSeats[p.id] || 'None'}</span> ({p.cabinClass})
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right panel: Seat selector map */}
                            <div style={{ flex: '2 1 300px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <h3 style={{ fontSize: '0.95rem', color: '#a78bfa', marginBottom: '0.75rem' }}>
                                    Select Seat for {selectedBooking.passengers[activePassengerIdx]?.firstName}
                                </h3>
                                <div style={{
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '40px 40px 12px 12px',
                                    padding: '2rem 1rem 1rem',
                                    width: '280px',
                                    background: 'rgba(0,0,0,0.2)',
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center'
                                }}>
                                    {/* Column Labels */}
                                    <div style={{ display: 'flex', gap: '6px', width: '200px', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}>
                                        <span>A</span>
                                        <span>B</span>
                                        <span>C</span>
                                        <span style={{ width: '10px' }} />
                                        <span>D</span>
                                        <span>E</span>
                                        <span>F</span>
                                    </div>

                                    {/* Rows */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {getRowsForClass(selectedBooking.passengers[activePassengerIdx]?.cabinClass || 'ECONOMY').map((row) => (
                                            <div key={row} style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '220px', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', width: '12px', textAlign: 'right' }}>{row}</span>
                                                
                                                {['A', 'B', 'C'].map((letter) => {
                                                    const seatId = `${row}${letter}`;
                                                    const occupied = isSeatOccupied(seatId);
                                                    const selected = passengerSeats[selectedBooking.passengers[activePassengerIdx]?.id] === seatId;
                                                    return (
                                                        <button
                                                            key={letter}
                                                            type="button"
                                                            disabled={occupied}
                                                            onClick={() => {
                                                                const pid = selectedBooking.passengers[activePassengerIdx].id;
                                                                setPassengerSeats({ ...passengerSeats, [pid]: seatId });
                                                                setModalError(null);
                                                            }}
                                                            style={{
                                                                width: '22px',
                                                                height: '22px',
                                                                borderRadius: '4px',
                                                                border: selected ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.15)',
                                                                background: selected ? '#8b5cf6' : occupied ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                                cursor: occupied ? 'not-allowed' : 'pointer',
                                                                fontSize: '0.6rem',
                                                                fontWeight: 'bold',
                                                                color: selected ? '#fff' : occupied ? '#ef4444' : '#fff',
                                                                padding: 0
                                                            }}
                                                            title={occupied ? `Seat ${seatId} Occupied` : `Select Seat ${seatId}`}
                                                        >
                                                            {letter}
                                                        </button>
                                                    );
                                                })}

                                                {/* Aisle */}
                                                <span style={{ width: '10px', fontSize: '0.55rem', color: 'rgba(255,255,255,0.1)' }}>|</span>

                                                {['D', 'E', 'F'].map((letter) => {
                                                    const seatId = `${row}${letter}`;
                                                    const occupied = isSeatOccupied(seatId);
                                                    const selected = passengerSeats[selectedBooking.passengers[activePassengerIdx]?.id] === seatId;
                                                    return (
                                                        <button
                                                            key={letter}
                                                            type="button"
                                                            disabled={occupied}
                                                            onClick={() => {
                                                                const pid = selectedBooking.passengers[activePassengerIdx].id;
                                                                setPassengerSeats({ ...passengerSeats, [pid]: seatId });
                                                                setModalError(null);
                                                            }}
                                                            style={{
                                                                width: '22px',
                                                                height: '22px',
                                                                borderRadius: '4px',
                                                                border: selected ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.15)',
                                                                background: selected ? '#8b5cf6' : occupied ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                                cursor: occupied ? 'not-allowed' : 'pointer',
                                                                fontSize: '0.6rem',
                                                                fontWeight: 'bold',
                                                                color: selected ? '#fff' : occupied ? '#ef4444' : '#fff',
                                                                padding: 0
                                                            }}
                                                            title={occupied ? `Seat ${seatId} Occupied` : `Select Seat ${seatId}`}
                                                        >
                                                            {letter}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
                            <button
                                onClick={() => setSelectedBooking(null)}
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveSeats}
                                disabled={isSavingSeats}
                                style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                {isSavingSeats ? 'Saving...' : 'Save New Seats'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
