"use client"
import React, { useState, useEffect, Suspense, useTransition, useSyncExternalStore } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { toggleFavoriteCityGuideAction, submitCityGuideReviewAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { useRouter } from 'next/navigation';

const DEFAULT_CITY_NAME = 'Detroit';
const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

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
    const [mapFailed, setMapFailed] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const isHydrated = useSyncExternalStore(
        subscribeToHydration,
        getClientSnapshot,
        getServerSnapshot
    );
    const router = useRouter();

    // The map is decoration over a list that works without it, so a missing
    // geography file should say so rather than render an empty rectangle.
    useEffect(() => {
        // An enhancement, not a requirement: where fetch is unavailable the map
        // is simply assumed to work, rather than the check taking the page down.
        if (typeof fetch !== 'function') return;
        let cancelled = false;
        fetch('/map.json', { method: 'HEAD' })
            .then(response => { if (!cancelled && !response.ok) setMapFailed(true); })
            .catch(() => { if (!cancelled) setMapFailed(true); });
        return () => { cancelled = true; };
    }, []);

    /**
     * Selecting a city also resets the review form.
     *
     * Every city used to mount its own form against one shared piece of state,
     * so a draft typed for one city was the draft for all of them (#78).
     */
    const selectCity = (cityName: string | null) => {
        setSelectedCityName(cityName);
        setReviewContent('');
        setReviewRating(5);
        setFeedback(null);
    };

    const toggleFavorite = (cityId: number) => {
        startTransition(async () => {
            setFavorites((prev) => {
                const next = new Set(prev);
                if (next.has(cityId)) next.delete(cityId);
                else next.add(cityId);
                return next;
            });

            const revert = () => setFavorites((prev) => {
                const reverted = new Set(prev);
                if (reverted.has(cityId)) reverted.delete(cityId);
                else reverted.add(cityId);
                return reverted;
            });

            try {
                const result = await toggleFavoriteCityGuideAction(cityId);
                if (isActionValidationFailure(result)) {
                    revert();
                    setFeedback(result.error.message);
                    return;
                }
                setFeedback(null);
            } catch {
                revert();
                setFeedback('Please sign in to save favorites.');
            }
        });
    };

    const handleReviewSubmit = async (cityId: number) => {
        if (!reviewContent.trim()) return;
        try {
            const result = await submitCityGuideReviewAction(cityId, reviewRating, reviewContent);
            if (isActionValidationFailure(result)) {
                setFeedback(result.error.message);
                return;
            }
            setReviewContent('');
            setFeedback(null);
            router.refresh(); // Refresh page to show the new review
        } catch {
            setFeedback('Please sign in to submit a review.');
        }
    };

    const selectedCity = cities.find(city => city.city === selectedCityName) ?? null;

    return (
        <div className="guide page-container">
            <div className="map">
                {!isHydrated || mapFailed ? (
                    <p className="guide-map-state" role="status">
                        {mapFailed
                            ? 'The map could not be loaded. Choose a destination from the list instead.'
                            : 'Loading map…'}
                    </p>
                ) : (
                    <Suspense fallback={<p className="guide-map-state">Loading map…</p>}>
                        <ComposableMap
                            projection="geoEqualEarth"
                            projectionConfig={{ scale: 600, center: [-70, 28] }}
                            viewBox="0 0 800 500"
                        >
                            <Geographies geography="/map.json">
                                {({ geographies }: { geographies: Array<{ rsmKey: string }> }) =>
                                    geographies.map((geo) => (
                                        <Geography key={geo.rsmKey} geography={geo} fill="#444" stroke="#1F2328" />
                                    ))}
                            </Geographies>
                            {cities.map((city) => {
                                const isSelected = city.city === selectedCityName;
                                return (
                                    <Marker
                                        key={city.id}
                                        data-city={city.city}
                                        coordinates={[city.latlong[1], city.latlong[0]]}
                                        onClick={() => selectCity(city.city)}
                                    >
                                        {/*
                                          * Focusable and operable by keyboard. A marker that
                                          * answered only to a mouse made the map a decoration
                                          * for anyone not using one.
                                          */}
                                        <circle
                                            r={isSelected ? 8 : 5}
                                            fill={isSelected ? '#c084fc' : '#4EA0E9'}
                                            stroke="#0f0a19"
                                            strokeWidth={isSelected ? 2 : 0}
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`Show the guide for ${city.city}, ${city.country}`}
                                            aria-pressed={isSelected}
                                            className="guide-marker"
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    selectCity(city.city);
                                                }
                                            }}
                                        />
                                    </Marker>
                                );
                            })}
                        </ComposableMap>
                    </Suspense>
                )}
            </div>

            <div className="sticky-sidebar">
                {feedback && (
                    <p className="guide-feedback" role="alert">{feedback}</p>
                )}

                <div className="travel-guides">
                    <h2 className="guide-list-heading">Destinations</h2>
                    {cities.length === 0 ? (
                        <p className="guide-empty">No destination guides yet.</p>
                    ) : (
                        <ul>
                            {cities.map((city) => {
                                const isSelected = city.city === selectedCityName;
                                return (
                                    <li key={city.id} id={city.city} className={isSelected ? 'selected' : undefined}>
                                        <button
                                            type="button"
                                            className="guide-city-select"
                                            aria-pressed={isSelected}
                                            onClick={() => selectCity(city.city)}
                                        >
                                            {city.city}, {city.country}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => toggleFavorite(city.id)}
                                            disabled={isPending}
                                            className="guide-favourite"
                                            aria-pressed={favorites.has(city.id)}
                                            aria-label={
                                                favorites.has(city.id)
                                                    ? `Remove ${city.city} from favourites`
                                                    : `Add ${city.city} to favourites`
                                            }
                                        >
                                            {favorites.has(city.id) ? '❤️' : '🤍'}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/*
                  * One panel, for the city that is selected. Every city used to
                  * render its own, and each carried .sticky-sidebar -- which is
                  * position:absolute -- so they stacked on one another and over
                  * the list. That was the overlap (#78).
                  */}
                {selectedCity ? (
                    <section className="guide-extra" aria-label={`${selectedCity.city} guide`}>
                        <div className="guide-detail-actions">
                            <button type="button" onClick={() => selectCity(null)} className="guide-back">
                                ← All destinations
                            </button>
                            <button
                                type="button"
                                onClick={() => toggleFavorite(selectedCity.id)}
                                disabled={isPending}
                                className="guide-favourite-wide"
                                aria-pressed={favorites.has(selectedCity.id)}
                            >
                                {favorites.has(selectedCity.id) ? '❤️ Unfavorite' : '🤍 Favorite'}
                            </button>
                        </div>

                        <h3>{selectedCity.city}, {selectedCity.country}</h3>
                        <p>{selectedCity.description}</p>

                        <strong>Highlights:</strong>
                        <ul>
                            {selectedCity.highlights.map((highlight: string, index: number) => (
                                <li key={index}>{highlight}</li>
                            ))}
                        </ul>

                        <hr />

                        <h4>Reviews</h4>
                        {selectedCity.reviews && selectedCity.reviews.length > 0 ? (
                            <ul className="guide-reviews">
                                {selectedCity.reviews.map(r => (
                                    <li key={r.id}>
                                        <div className="guide-review-head">
                                            <img
                                                src={r.user?.image || "https://i.pravatar.cc/150"}
                                                alt=""
                                                width="24"
                                                height="24"
                                            />
                                            <strong>{r.user?.name || "Traveler"}</strong>
                                            <span className="guide-stars" aria-label={`${r.rating} out of 5`}>
                                                {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                                            </span>
                                        </div>
                                        <p>{r.content}</p>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="guide-empty">No reviews yet. Be the first!</p>
                        )}

                        <div className="guide-review-form">
                            <label htmlFor="review-rating">Your rating</label>
                            <select
                                id="review-rating"
                                value={reviewRating}
                                onChange={e => setReviewRating(Number(e.target.value))}
                            >
                                <option value="5">★★★★★ Excellent</option>
                                <option value="4">★★★★ Good</option>
                                <option value="3">★★★ Average</option>
                                <option value="2">★★ Poor</option>
                                <option value="1">★ Terrible</option>
                            </select>
                            <label htmlFor="review-content">Your review</label>
                            <textarea
                                id="review-content"
                                value={reviewContent}
                                onChange={e => setReviewContent(e.target.value)}
                                placeholder="Share your experience…"
                            />
                            <button
                                type="button"
                                onClick={() => handleReviewSubmit(selectedCity.id)}
                                disabled={!reviewContent.trim()}
                                className="guide-review-submit"
                            >
                                Submit Review
                            </button>
                        </div>
                    </section>
                ) : (
                    <p className="guide-empty guide-detail-empty">
                        Choose a destination on the map or in the list to read its guide.
                    </p>
                )}
            </div>
        </div>
    );
}
