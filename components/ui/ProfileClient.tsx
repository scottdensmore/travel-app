"use client"

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import PointsActivityTable from "@/components/ui/pointsActivityTable";
import NextStatusChart from "@/components/ui/charts/nextStatusChart";
import PointsHistoryChart from "@/components/ui/charts/pointsHistoryChart";
import { flightFareCents, formatPrice } from '@/lib/bookingPricing';
import { legDirectionLabel, orderedLegs, outboundFlight, seatLabel } from '@/lib/bookingItinerary';
import { cancelBookingAction, deleteReviewAction, toggleFavoriteCityGuideAction, changeBookingSeatsAction, getOccupiedSeatsAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { PointsActivityDisplayData } from '@/lib/types/PointsActivity';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    priceCents: number;
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}

interface Passenger {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
}

interface SeatAssignment {
    passengerId: string;
    seatNumber: string;
    cabinClass: string;
}

interface BookingLeg {
    id: number;
    sequence: number;
    flight: Flight | null;
    seatAssignments?: SeatAssignment[];
}

interface Booking {
    id: number;
    createdAt: Date | string;
    status: string; // "CONFIRMED" or "CANCELLED"
    totalPriceCents: number | null;
    // The itinerary. One leg today; a round trip adds the inbound (#69).
    legs: BookingLeg[];
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
    // Occupancy and seat choices are both per leg: a seat belongs to one
    // flight, so a round trip holds a different one on each.
    const [modalOccupiedSeats, setModalOccupiedSeats] = useState<{ [legId: number]: string[] }>({});
    const [passengerSeats, setPassengerSeats] = useState<{ [legAndPassenger: string]: string }>({});
    const [activePassengerIdx, setActivePassengerIdx] = useState<number>(0);
    const [activeLegIdx, setActiveLegIdx] = useState<number>(0);
    const [modalError, setModalError] = useState<string | null>(null);
    const [isSavingSeats, setIsSavingSeats] = useState<boolean>(false);

    const modalLegs = selectedBooking
        ? orderedLegs(selectedBooking).filter(leg => leg.flight)
        : [];
    const activeLeg = modalLegs[activeLegIdx] ?? null;
    /** Seat state is keyed by leg and passenger together. */
    const seatKey = (legId: number, passengerId: string) => `${legId}:${passengerId}`;
    const seatFor = (passengerId: string) =>
        activeLeg ? passengerSeats[seatKey(activeLeg.id, passengerId)] ?? '' : '';
    /** The cabin held on the leg being looked at, which is where it is recorded. */
    const cabinFor = (passengerId: string) =>
        activeLeg?.seatAssignments?.find(seat => seat.passengerId === passengerId)?.cabinClass
        ?? 'ECONOMY';

    useEffect(() => {
        if (!selectedBooking) return;
        const legs = orderedLegs(selectedBooking).filter(leg => leg.flight);
        if (legs.length === 0) return;

        // Each leg's own flight, so a seat taken on the outbound does not read
        // as taken on the return.
        Promise.all(legs.map(leg =>
            getOccupiedSeatsAction(leg.flight!.id)
                .then(seats => [leg.id, seats] as const)
                .catch(() => [leg.id, [] as string[]] as const)
        )).then(entries => {
            setModalOccupiedSeats(Object.fromEntries(entries));
        });

        const initial: { [key: string]: string } = {};
        for (const leg of legs) {
            for (const passenger of selectedBooking.passengers) {
                // The assignment is the only record of where someone sits. The
                // fallback here seeded the outbound seat onto every other leg,
                // so a return seat opened pre-filled with the wrong one (#137).
                initial[`${leg.id}:${passenger.id}`] =
                    leg.seatAssignments?.find(seat => seat.passengerId === passenger.id)?.seatNumber ?? '';
            }
        }
        setPassengerSeats(initial);
        setActivePassengerIdx(0);
        setActiveLegIdx(0);
        setModalError(null);
    }, [selectedBooking]);

    const handleCancelBooking = (bookingId: number, flightNumber: string) => {
        if (!confirm(`Are you sure you want to cancel booking for flight ${flightNumber}? This will release your seats.`)) return;

        startTransition(async () => {
            try {
                const result = await cancelBookingAction(bookingId);
                if (isActionValidationFailure(result)) throw new Error(result.error.message);
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
                const result = await deleteReviewAction(reviewId);
                if (isActionValidationFailure(result)) throw new Error(result.error.message);
                router.refresh();
            } catch (error) {
                alert('Failed to delete review. Please try again.');
            }
        });
    };

    const handleUnfavorite = (cityId: number, cityName: string) => {
        startTransition(async () => {
            try {
                const result = await toggleFavoriteCityGuideAction(cityId);
                if (isActionValidationFailure(result)) throw new Error(result.error.message);
                router.refresh();
            } catch (error) {
                alert('Failed to update favorite. Please try again.');
            }
        });
    };

    const handleSaveSeats = async () => {
        if (!selectedBooking) return;

        for (const leg of modalLegs) {
            for (const p of selectedBooking.passengers) {
                if (!passengerSeats[seatKey(leg.id, p.id)]) {
                    const which = modalLegs.length > 1
                        ? ` on the ${leg.id === modalLegs[0].id ? 'departing' : 'returning'} flight`
                        : '';
                    setModalError(`Please select a seat for ${p.firstName} ${p.lastName}${which}`);
                    setActiveLegIdx(modalLegs.indexOf(leg));
                    return;
                }
            }
        }

        setIsSavingSeats(true);
        setModalError(null);

        try {
            const seatChanges = modalLegs.flatMap(leg =>
                selectedBooking.passengers.map(p => ({
                    passengerId: p.id,
                    legId: leg.id,
                    seatNumber: passengerSeats[seatKey(leg.id, p.id)]
                }))
            );

            const result = await changeBookingSeatsAction(selectedBooking.id, seatChanges);
            if (isActionValidationFailure(result)) {
                setModalError(result.error.message);
                return;
            }
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
        const flight = activeLeg?.flight ?? null;
        const firstClassCount = flight?.firstClassRows !== undefined && flight?.firstClassRows !== null ? Number(flight.firstClassRows) : 3;
        const businessCount = flight?.businessRows !== undefined && flight?.businessRows !== null ? Number(flight.businessRows) : 3;
        const premiumEconomyCount = flight?.premiumEconomyRows !== undefined && flight?.premiumEconomyRows !== null ? Number(flight.premiumEconomyRows) : 4;
        const economyCount = flight?.economyRows !== undefined && flight?.economyRows !== null ? Number(flight.economyRows) : 20;

        let currentOffset = 1;

        if (cabinClass === 'FIRST') {
            return Array.from({ length: firstClassCount }, (_, i) => currentOffset + i);
        }
        currentOffset += firstClassCount;

        if (cabinClass === 'BUSINESS') {
            return Array.from({ length: businessCount }, (_, i) => currentOffset + i);
        }
        currentOffset += businessCount;

        if (cabinClass === 'PREMIUM_ECONOMY') {
            return Array.from({ length: premiumEconomyCount }, (_, i) => currentOffset + i);
        }
        currentOffset += premiumEconomyCount;

        if (cabinClass === 'ECONOMY') {
            return Array.from({ length: economyCount }, (_, i) => currentOffset + i);
        }
        return Array.from({ length: economyCount }, (_, i) => currentOffset + i);
    };

    const isSeatOccupied = (seat: string) => {
        if (!selectedBooking || !activeLeg) return false;
        const activePassenger = selectedBooking.passengers[activePassengerIdx];

        // Seats the other travellers on this booking hold on this leg.
        const selectedByOthers = selectedBooking.passengers
            .filter(p => p.id !== activePassenger?.id)
            .map(p => seatFor(p.id));

        // This booking's own seats on this leg are not obstacles to itself.
        const ownSeatsOnLeg = selectedBooking.passengers.map(p =>
            activeLeg.seatAssignments?.find(s => s.passengerId === p.id)?.seatNumber
        );
        const occupiedByOthersOnFlight = (modalOccupiedSeats[activeLeg.id] ?? []).filter(
            s => !ownSeatsOnLeg.includes(s)
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
                                {bookings.map((booking) => {
                                    const legs = orderedLegs(booking).filter(leg => leg.flight);
                                    const isCancelled = booking.status === 'CANCELLED';
                                    // Every leg is a row of its own, so the browser
                                    // keeps each flight aligned with its route and
                                    // date at any width. Booking-level cells span
                                    // them. One tbody per booking groups the legs.
                                    const legRows = legs.length > 0 ? legs : [null];
                                    const seatFor = (leg: BookingLeg | null, passengerId: string) =>
                                        seatLabel(
                                            leg?.seatAssignments?.find(seat => seat.passengerId === passengerId)?.seatNumber
                                        );
                                    return (
                                        <tbody key={booking.id} data-testid={`booking-row-${booking.id}`} className="border-b">
                                            {legRows.map((leg, index) => (
                                                <tr
                                                    key={leg?.flight?.id ?? index}
                                                    data-testid={`booking-leg-${booking.id}-${index}`}
                                                    data-continues-booking={index > 0 ? '' : undefined}
                                                >
                                                    <td className="py-2">
                                                        {index === 0 && (
                                                            <div style={{ fontSize: '0.7rem', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                                {legs.length > 1 ? 'Round trip' : 'One way'}
                                                            </div>
                                                        )}
                                                        <div>{leg?.flight ? `${leg.flight.airline} ${leg.flight.flightNumber}` : '\u2014'}</div>
                                                        {booking.passengers && booking.passengers.length > 0 && (
                                                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                                                                {booking.passengers
                                                                    .map(p => `${p.firstName} (${seatFor(leg, p.id)})`)
                                                                    .join(', ')}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-2">{leg?.flight ? `${leg.flight.from} \u2192 ${leg.flight.to}` : '\u2014'}</td>
                                                    <td className="py-2 whitespace-nowrap">{leg?.flight ? new Date(leg.flight.departureDate).toLocaleDateString() : '\u2014'}</td>
                                                    {index === 0 && (
                                                        <>
                                                            <td className="py-2 whitespace-nowrap align-top" rowSpan={legRows.length}>{
                                                                booking.totalPriceCents !== null && booking.totalPriceCents !== undefined
                                                                    ? formatPrice(booking.totalPriceCents)
                                                                    : legs[0]?.flight ? formatPrice(flightFareCents(legs[0].flight)) : '\u2014'
                                                            }</td>
                                                            <td className="py-2 align-top" rowSpan={legRows.length}>
                                                                <span style={{
                                                                    color: isCancelled ? '#ef4444' : '#10b981',
                                                                    fontWeight: 'bold',
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    {isCancelled ? 'Cancelled' : 'Confirmed'}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 text-right align-top" rowSpan={legRows.length}>
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
                                                                                cursor: 'pointer',
                                                                                whiteSpace: 'nowrap'
                                                                            }}
                                                                        >
                                                                            Change Seats
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleCancelBooking(booking.id, legs[0]?.flight?.flightNumber || '')}
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
                                                        </>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    );
                                })}
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
                            <div role="alert" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                ⚠️ {modalError}
                            </div>
                        )}

                        {modalLegs.length > 1 && (
                            <div
                                role="tablist"
                                aria-label="Itinerary leg"
                                data-testid="seat-change-legs"
                                style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}
                            >
                                {modalLegs.map((leg, index) => {
                                    const isActive = index === activeLegIdx;
                                    return (
                                        <button
                                            key={leg.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={isActive}
                                            onClick={() => setActiveLegIdx(index)}
                                            style={{
                                                // globals.css pins buttons to 52px.
                                                height: 'auto',
                                                minHeight: '52px',
                                                width: 'auto',
                                                flex: '1 1 12rem',
                                                padding: '10px 16px',
                                                borderRadius: '8px',
                                                border: `2px solid ${isActive ? '#8b5cf6' : 'rgba(255,255,255,0.15)'}`,
                                                background: isActive ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
                                                color: '#fff',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <span style={{ display: 'block', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                                {legDirectionLabel(index, modalLegs.length)}
                                            </span>
                                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                                                {leg.flight!.from} → {leg.flight!.to}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
                            {/* Left panel: Passengers list */}
                            <div style={{ flex: '1 1 200px' }}>
                                <h3 style={{ fontSize: '0.95rem', color: '#a78bfa', marginBottom: '0.75rem' }}>Passengers</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {selectedBooking.passengers.map((p, idx) => (
                                        <button
                                            type="button"
                                            key={p.id}
                                            onClick={() => setActivePassengerIdx(idx)}
                                            aria-pressed={activePassengerIdx === idx}
                                            aria-label={`${p.firstName} ${p.lastName}, Seat: ${seatFor(p.id) || 'None'}, ${cabinFor(p.id)}`}
                                            style={{
                                                width: '100%',
                                                color: 'inherit',
                                                textAlign: 'left',
                                                padding: '10px',
                                                borderRadius: '8px',
                                                border: activePassengerIdx === idx ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.08)',
                                                background: activePassengerIdx === idx ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.01)',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{p.firstName} {p.lastName}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                                                Seat: <span style={{ color: '#34d399', fontWeight: 'bold' }}>{seatFor(p.id) || 'None'}</span> ({cabinFor(p.id)})
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Right panel: Seat selector map */}
                            {(() => {
                                const parsedPattern = outboundFlight(selectedBooking)?.seatPattern || "ABC-DEF";
                                const activeCabinRows = getRowsForClass(
                                    cabinFor(selectedBooking.passengers[activePassengerIdx]?.id ?? '')
                                );
                                return (
                                    <div style={{ flex: '2 1 300px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <h3 style={{ fontSize: '0.95rem', color: '#a78bfa', marginBottom: '0.75rem' }}>
                                            Select Seat for {selectedBooking.passengers[activePassengerIdx]?.firstName}
                                        </h3>
                                        {activeCabinRows.length === 0 ? (
                                            <p role="alert" style={{ color: '#f87171', textAlign: 'center' }}>
                                                This cabin has no seats in the current flight layout. Contact support to change this booking.
                                            </p>
                                        ) : <div style={{
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '40px 40px 12px 12px',
                                            padding: '2rem 1rem 1rem',
                                            width: 'min(100%, 280px)',
                                            background: 'rgba(0,0,0,0.2)',
                                            maxHeight: '300px',
                                            overflow: 'auto',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center'
                                        }}>
                                            {/* Column Labels */}
                                            <div style={{
                                                display: 'flex',
                                                gap: '6px',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: `${Math.max(240, parsedPattern.length * 36)}px`,
                                                flexShrink: 0,
                                                paddingLeft: '18px',
                                                marginBottom: '8px',
                                                fontSize: '0.7rem',
                                                color: 'rgba(255,255,255,0.4)',
                                                fontWeight: 'bold'
                                            }}>
                                                {parsedPattern.split("").map((char, charIdx) => {
                                                    if (char === '-') {
                                                        return (
                                                            <span
                                                                key={`aisle-header-${charIdx}`}
                                                                style={{ width: '10px' }}
                                                            />
                                                        );
                                                    }
                                                    return (
                                                        <span
                                                            key={`seat-header-${charIdx}`}
                                                            style={{ width: '22px', textAlign: 'center' }}
                                                        >
                                                            {char}
                                                        </span>
                                                    );
                                                })}
                                            </div>

                                            {/* Rows */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: `${Math.max(240, parsedPattern.length * 36)}px`, flexShrink: 0 }}>
                                                {activeCabinRows.map((row) => (
                                                    <div key={row} style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center' }}>
                                                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', width: '12px', textAlign: 'right', marginRight: '2px' }}>{row}</span>

                                                        {parsedPattern.split("").map((char, charIdx) => {
                                                            if (char === '-') {
                                                                return (
                                                                    <span
                                                                        key={`aisle-${charIdx}`}
                                                                        style={{
                                                                            width: '10px',
                                                                            textAlign: 'center',
                                                                            fontSize: '0.55rem',
                                                                            color: 'rgba(255,255,255,0.1)',
                                                                            userSelect: 'none'
                                                                        }}
                                                                    >
                                                                        |
                                                                    </span>
                                                                );
                                                            }

                                                            const letter = char;
                                                            const seatId = `${row}${letter}`;
                                                            const occupied = isSeatOccupied(seatId);
                                                            const selected = seatFor(selectedBooking.passengers[activePassengerIdx]?.id) === seatId;
                                                            return (
                                                                <button
                                                                    key={letter}
                                                                    type="button"
                                                                    disabled={occupied}
                                                                    onClick={() => {
                                                                        const pid = selectedBooking.passengers[activePassengerIdx].id;
                                                                        if (!activeLeg) return;
                                                                        setPassengerSeats({ ...passengerSeats, [seatKey(activeLeg.id, pid)]: seatId });
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
                                        </div>}
                                    </div>
                                );
                            })()}
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
