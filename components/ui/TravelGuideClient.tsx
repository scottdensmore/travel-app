"use client"
import React, { useState, Suspense, useTransition } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { toggleFavoriteCityGuideAction, submitCityGuideReviewAction } from '@/app/actions';
import { useRouter } from 'next/navigation';

const DEFAULT_CITY_NAME = 'Detroit';

interface Review {
    id: string;
    content: string;
    rating: number;
    user: { name: string | null; image: string | null };
}

interface City {
    id: number;
    city: string;
    country: string;
    latlong: number[];
    description: string;
    highlights: string[];
    coverImage: string | null;
    reviews: Review[];
}

export default function TravelGuideClient({ cities, initialFavorites }: { cities: City[], initialFavorites: number[] }) {
    const [selectedCityName, setSelectedCityName] = useState<string | null>(DEFAULT_CITY_NAME);
    const [favorites, setFavorites] = useState<Set<number>>(new Set(initialFavorites));
    const [isPending, startTransition] = useTransition();
    const [reviewContent, setReviewContent] = useState('');
    const [reviewRating, setReviewRating] = useState(5);
    const router = useRouter();

    const handleMarkerClick = (cityName: string) => {
        setSelectedCityName(cityName);
    };

    const toggleFavorite = (cityId: number) => {
        startTransition(async () => {
            const nextFavs = new Set(favorites);
            if (nextFavs.has(cityId)) nextFavs.delete(cityId);
            else nextFavs.add(cityId);

            setFavorites(nextFavs);

            try {
                await toggleFavoriteCityGuideAction(cityId);
            } catch (error) {
                // Revert if error
                setFavorites(new Set(favorites));
                alert('Please sign in to save favorites.');
            }
        });
    };

    const handleReviewSubmit = async (cityId: number) => {
        if (!reviewContent.trim()) return;
        try {
            await submitCityGuideReviewAction(cityId, reviewRating, reviewContent);
            setReviewContent('');
            router.refresh(); // Refresh page to show the new review
        } catch (error) {
            alert('Please sign in to submit a review.');
        }
    };

    return (
        <div className="guide page-container">
            <div className="map">
                <Suspense fallback={<div>Loading Map...</div>}>
                    <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 600, center: [-70, 28] }} style={{ maxHeight: "1400" }} preserveAspectRatio="none" viewBox="0 0 800 500">
                        <Geographies geography="/map.json">
                            {({ geographies }: { geographies: any[] }) => geographies.map((geo) => (
                                <Geography key={geo.rsmKey} geography={geo} fill="#444" stroke="#1F2328" />
                            ))}
                        </Geographies>
                        {cities.map((city, index) => (
                            <Marker
                                key={index}
                                coordinates={[city.latlong[1], city.latlong[0]]}
                                onClick={() => handleMarkerClick(city.city)}
                                style={{ cursor: 'pointer' }}
                            >
                                <circle r={5} fill="#4EA0E9" style={{ cursor: 'pointer' }} />
                            </Marker>
                        ))}
                    </ComposableMap>
                </Suspense>
            </div>

            <div className="sticky-sidebar">
                <div className="travel-guides">
                    <ul>
                        {cities.map((city, index) => (
                            <li key={index} id={city.city}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h3 onClick={() => handleMarkerClick(city.city)} style={{ cursor: 'pointer', margin: 0 }}>
                                        {city.city}, {city.country}
                                    </h3>
                                    <button
                                        onClick={() => toggleFavorite(city.id)}
                                        disabled={isPending}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
                                    >
                                        {favorites.has(city.id) ? '❤️' : '🤍'}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>

                {cities.map((city) => (
                    <div key={city.city} className={"sticky-sidebar guide-extra " + (city.city === selectedCityName ? 'highlight' : '')}>
                        <div className={city.city === selectedCityName ? 'highlight' : ''}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong><a href="#" onClick={(e) => { e.preventDefault(); handleMarkerClick(''); }}>← Back</a></strong>
                                <button
                                    onClick={() => toggleFavorite(city.id)}
                                    disabled={isPending}
                                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded shadow-sm hover:bg-blue-200"
                                >
                                    {favorites.has(city.id) ? '❤️ Unfavorite' : '🤍 Favorite'}
                                </button>
                            </div>
                            <h3 className="mt-4">{city.city}, {city.country}</h3>
                            <p>{city.description}</p>
                            <strong>Highlights:</strong>
                            <ul>
                                {city.highlights.map((highlight: string, index: number) => (
                                    <li key={index}>{highlight}</li>
                                ))}
                            </ul>

                            <hr className="my-6" />

                            <h4>Reviews</h4>
                            {city.reviews && city.reviews.length > 0 ? (
                                <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
                                    {city.reviews.map(r => (
                                        <li key={r.id} style={{ marginBottom: '1rem', borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                                <img src={r.user?.image || "https://i.pravatar.cc/150"} alt="Avatar" width="24" height="24" style={{ borderRadius: '50%' }} />
                                                <strong>{r.user?.name || "Traveler"}</strong>
                                                <span style={{ color: '#f59e0b' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                                            </div>
                                            <p style={{ margin: 0 }}>{r.content}</p>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-gray-500 italic">No reviews yet. Be the first!</p>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                                <select
                                    value={reviewRating}
                                    onChange={e => setReviewRating(Number(e.target.value))}
                                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                                >
                                    <option value="5">⭐⭐⭐⭐⭐ Excellent</option>
                                    <option value="4">⭐⭐⭐⭐ Good</option>
                                    <option value="3">⭐⭐⭐ Average</option>
                                    <option value="2">⭐⭐ Poor</option>
                                    <option value="1">⭐ Terrible</option>
                                </select>
                                <textarea
                                    value={reviewContent}
                                    onChange={e => setReviewContent(e.target.value)}
                                    placeholder="Share your experience..."
                                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', minHeight: '80px', color: 'black' }}
                                />
                                <button
                                    onClick={() => handleReviewSubmit(city.id)}
                                    style={{ padding: '0.5rem', background: '#3b82f6', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    Submit Review
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
