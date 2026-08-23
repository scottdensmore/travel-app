"use client"
import React, { useState, useEffect, useRef, useTransition, useSyncExternalStore } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { toggleFavoriteCityGuideAction, submitCityGuideReviewAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { useRouter } from 'next/navigation';

const DEFAULT_CITY_NAME = 'Detroit';
// How long the topology may be in flight before the panel stops calling it
// loading and offers the list instead. See the deadline effect below.
const MAP_LOAD_TIMEOUT_MS = 10_000;
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
    const [topology, setTopology] = useState<object | null>(null);
    const [mapTimedOut, setMapTimedOut] = useState(false);
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
        // Without fetch the topology cannot be loaded at all, so say so rather
        // than leaving the panel claiming to be loading forever.
        if (typeof fetch !== 'function') { setMapFailed(true); return; }
        let cancelled = false;
        // One fetch, and the result is kept. `Geographies` accepts a parsed
        // topology as well as a URL, so passing the object means this component
        // owns the request — and owning it is the only way to see a failure at
        // all: `react-simple-maps` swallows every failure of its own fetch
        // (non-ok, reject, and a `res.json()` parse error alike) into a
        // `console.log`, resolves undefined, and leaves `geographies` empty
        // forever. A HEAD probe could not see it either, since a truncated file
        // or an HTML error page served with 200 has a perfectly good status.
        fetch('/map.json')
            .then(response => {
                if (!response.ok) throw new Error(`map.json: ${response.status}`);
                return response.json();
            })
            .then(parsed => {
                if (cancelled) return;
                // Parsing is not validating, and the difference is a crash. A
                // gateway answering 200 with `{"error":"not found"}` parses
                // perfectly; `Geographies` then calls `.map()` on that object
                // during render and throws, taking the tree to the nearest
                // error boundary. A body of literal `null` is quieter and worse
                // — it leaves the panel on "taking longer" forever. Accept the
                // two shapes the library actually handles.
                const shape = parsed as { type?: string; features?: unknown } | null;
                const isTopology = !!shape && typeof shape === 'object'
                    && (shape.type === 'Topology' || Array.isArray(shape.features));
                if (!isTopology) throw new Error('map.json: not a topology');
                setTopology(parsed);
                // Insurance against a future second `setTopology`: today this
                // batches with the line above and the overlay is gated on
                // `!topology`, so nothing can render the stale copy.
                setMapTimedOut(false);
            })
            .catch(() => { if (!cancelled) setMapFailed(true); });
        return () => { cancelled = true; };
    }, []);

    /**
     * A request that never resolves is not a loading state forever.
     *
     * The probe above catches a response that arrives and is bad, one that
     * rejects, and a body that will not parse. A request that never resolves
     * satisfies none of them, and #318's own repro is exactly that — so without
     * a deadline the honest loading message this component renders would simply
     * never go away. Ten seconds is a judgement call: long enough that a slow
     * connection still gets its map, short enough that nobody reads
     * "Loading map…" as the final answer.
     */
    useEffect(() => {
        if (mapFailed || topology) return;
        const timer = setTimeout(() => setMapTimedOut(true), MAP_LOAD_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [mapFailed, topology]);

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
        if (cityName) revealDetail();
    };

    /**
     * Put the selected city's panel where the customer can see and use it.
     *
     * Stacked, the panel renders below a ten-item list and lands about 1200px past
     * the fold, so choosing a city changed nothing anyone could see: the heading
     * said the right thing 1200px away, and the only on-screen difference was a
     * five-pixel dot changing colour.
     *
     * Called from the click handler rather than from an effect keyed on the
     * selection, which got this wrong three ways. Selecting the city that is
     * *already* selected -- `DEFAULT_CITY_NAME` on every fresh load, so the most
     * likely first tap on a phone -- sets identical state, React bails out, and no
     * effect runs. A ref guard meant to skip the mount is defeated by Strict Mode's
     * double invocation, because refs survive the simulated remount, so the page
     * scrolled itself on arrival in development. And an effect cannot tell a
     * selection the customer asked for from one the component chose for them. A
     * handler runs exactly when somebody acts, which is the condition that was
     * wanted all along.
     *
     * Focus moves with the viewport. Scrolling alone left focus on the marker the
     * customer had just pressed, now off-screen above, so the next Tab scrolled
     * back up to the following marker and the panel could not be operated by
     * keyboard at all. Moving focus also announces the change, which nothing else
     * here does. `preventScroll` keeps the scrolling in one place below rather than
     * having focus and `scrollIntoView` each contribute some.
     */
    const revealDetail = () => {
        const panel = detailRef.current;
        if (!panel) return;
        panel.focus({ preventScroll: true });
        // `scroll-margin-top` on `.guide-extra` keeps this clear of the header:
        // `nearest` start-aligns an element taller than the scrollport, which
        // otherwise parks the panel's controls underneath it.
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    const detailRef = useRef<HTMLElement | null>(null);

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
                    <>
                        {/*
                          * Laid *over* the map, not beside it. The city markers
                          * live inside `ComposableMap` and stay visible and
                          * clickable while the topology is in flight, and as a
                          * flex sibling this squeezed the SVG and rescaled every
                          * marker when it left. It also never unmounts the map:
                          * a slow topology still arriving at t=11s clears this
                          * message, where flipping `mapFailed` would have thrown
                          * the markers away for the rest of the session.
                          *
                          * `role="status"` rather than `alert` even once timed
                          * out: the condition is transient and self-healing, and
                          * the genuine failure above is only `status` too.
                          * React hydrates the pre-hydration element into this
                          * one — same node, patched class — so the text does not
                          * re-announce on hydration.
                          */}
                        {!topology && (
                            <p
                                className="guide-map-state guide-map-state--overlay"
                                role="status"
                            >
                                {mapTimedOut
                                    ? 'The map is taking longer than expected. Choose a destination from the list instead.'
                                    : 'Loading map…'}
                            </p>
                        )}
                        <ComposableMap
                            projection="geoEqualEarth"
                            projectionConfig={{ scale: 600, center: [-70, 28] }}
                            viewBox="0 0 800 500"
                        >
                            {topology && (
                                <Geographies geography={topology}>
                                    {({ geographies }: { geographies: Array<{ rsmKey: string }> }) =>
                                        geographies.map((geo) => (
                                            <Geography
                                                key={geo.rsmKey}
                                                geography={geo}
                                                fill="#444"
                                                stroke="#1F2328"
                                                /* The country outlines are decoration: the
                                                   interactive things on this map are the city
                                                   markers below. Left alone, react-simple-maps
                                                   renders each one as a focusable `path` with no
                                                   accessible name and no role -- 202 of them, 176
                                                   clipped outside the viewBox entirely, so a
                                                   keyboard user reached the first city marker on
                                                   tab stop 209 after 202 stops that announce
                                                   nothing and cannot be seen (#78's
                                                   "inaccessible content"). */
                                                tabIndex={-1}
                                                aria-hidden="true"
                                                style={{
                                                    default: { outline: 'none' },
                                                    hover: { outline: 'none' },
                                                    pressed: { outline: 'none' },
                                                }}
                                            />
                                        ))}
                                </Geographies>
                            )}
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
                    </>
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
                    <section
                        className="guide-extra"
                        aria-label={`${selectedCity.city} guide`}
                        ref={detailRef}
                        /* Focusable programmatically only: this is a destination for
                           focus after a selection, not a tab stop of its own. */
                        tabIndex={-1}
                    >
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
                                            {/* Reviewer avatars can originate from arbitrary OAuth providers. */}
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
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
