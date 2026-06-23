"use client"

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import PointsActivityTable from "@/components/ui/pointsActivityTable";
import NextStatusChart from "@/components/ui/charts/nextStatusChart";
import PointsHistoryChart from "@/components/ui/charts/pointsHistoryChart";
import { cancelBookingAction, deleteReviewAction, toggleFavoriteCityGuideAction } from '@/app/actions';
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

interface Booking {
    id: number;
    createdAt: Date | string;
    flight: Flight | null;
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

    const handleCancelBooking = (bookingId: number, flightNumber: string) => {
        if (!confirm(`Are you sure you want to cancel booking for flight ${flightNumber}?`)) return;

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
                                        <th className="pb-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bookings.map((booking) => {
                                        const flight = booking.flight;
                                        return (
                                            <tr key={booking.id} className="border-b">
                                                <td className="py-2">{flight ? `${flight.airline} ${flight.flightNumber}` : '—'}</td>
                                                <td className="py-2">{flight ? `${flight.from} → ${flight.to}` : '—'}</td>
                                                <td className="py-2">{flight ? new Date(flight.departureDate).toLocaleDateString() : '—'}</td>
                                                <td className="py-2">{flight?.price ?? '—'}</td>
                                                <td className="py-2 text-right">
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
        </div>
    );
}
