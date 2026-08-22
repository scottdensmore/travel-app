import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TextEncoder } from 'util';
import '@testing-library/jest-dom';
import TravelGuideClient from '@/components/ui/TravelGuideClient';
import { toggleFavoriteCityGuideAction, submitCityGuideReviewAction } from '@/app/actions';
import { useRouter } from 'next/navigation';

Object.defineProperty(global, 'TextEncoder', { value: TextEncoder });
const { renderToString } = jest.requireActual<typeof import('react-dom/server')>(
    'react-dom/server'
);

jest.mock('next/navigation', () => ({
    useRouter: jest.fn().mockReturnValue({
        refresh: jest.fn(),
    }),
}));

jest.mock('@/app/actions', () => ({
    toggleFavoriteCityGuideAction: jest.fn(),
    submitCityGuideReviewAction: jest.fn(),
}));

// What `Geographies` yields is configurable, because the bug in #318 lives in
// the window where it yields nothing: it fetches its topology in an effect and
// never suspends, so an in-flight fetch renders an empty list rather than
// triggering any fallback.
let mockGeographies: Array<{ rsmKey: string }> = [{ rsmKey: '1' }];

jest.mock('react-simple-maps', () => ({
    ComposableMap: ({ children }: any) => <svg data-testid="map">{children}</svg>,
    Geographies: ({ children }: any) => children({ geographies: mockGeographies }),
    // Forwards the two props the component sets deliberately. The real
    // `Geography` puts them on the `path` it renders, so this is what the fix
    // actually consists of.
    Geography: ({ tabIndex, ...props }: any) => (
        <path data-testid="geography" tabIndex={tabIndex} aria-hidden={props['aria-hidden']} />
    ),
    Marker: ({ children, onClick }: any) => <g onClick={onClick} data-testid="marker">{children}</g>,
}));

const mockToggleFavorite = toggleFavoriteCityGuideAction as jest.Mock;
const mockSubmitReview = submitCityGuideReviewAction as jest.Mock;

const sampleCities = [
    {
        id: 1,
        city: 'Detroit',
        country: 'USA',
        latlong: [42.3314, -83.0458],
        description: 'Motor City',
        highlights: ['Motown Museum', 'Detroit Institute of Arts'],
        coverImage: null,
        reviews: [
            {
                id: 'r1',
                content: 'Great music history!',
                rating: 5,
                user: { name: 'Alice', image: null },
            }
        ],
    },
    {
        id: 2,
        city: 'Paris',
        country: 'France',
        latlong: [48.8566, 2.3522],
        description: 'City of Lights',
        highlights: ['Eiffel Tower', 'Louvre Museum'],
        coverImage: '/img/paris.jpg',
        reviews: [],
    }
];

describe('TravelGuideClient', () => {
    // The component owns the `/map.json` request now and passes the parsed
    // topology to `Geographies`, so jsdom's missing `fetch` is no longer a
    // detail the tests can ignore — without one the panel correctly reports
    // failure. Resolving a stub topology is what the browser does.
    const stubTopology = { type: 'Topology', objects: {} };
    let realFetch: typeof fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        global.alert = jest.fn();
        mockGeographies = [{ rsmKey: '1' }];
        realFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(stubTopology),
        }) as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = realFetch;
    });

    it('says the map is loading while the topology is still in flight', async () => {
        // #318: `Geographies` fetches in an effect and does not suspend, so the
        // `Suspense` fallback can never fire and the pre-hydration branch is
        // already past. With the topology in flight the panel rendered city
        // markers over nothing, with no `.guide-map-state` element at all —
        // ten unexplained dots on a black gradient.
        mockGeographies = [];

        const { container } = render(
            <TravelGuideClient cities={sampleCities} initialFavorites={[]} />
        );

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent(/loading map/i);
        // The modifier is the half with the visual consequence, and it was
        // unpinned: without it the message is a flex sibling of the SVG rather
        // than an overlay, which squeezes the map to an 85px column and
        // rescales every marker by 13.7-30.9% when the message leaves. Deleting
        // the class left the whole suite green.
        expect(status).toHaveClass('guide-map-state', 'guide-map-state--overlay');
        expect(container.querySelector('.guide-map-state--overlay')).not.toBeNull();
    });

    it('drops the loading message once the topology arrives', async () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        await waitFor(() => {
            expect(screen.queryByText(/loading map/i)).not.toBeInTheDocument();
        });
        expect(screen.getByTestId('map')).toBeInTheDocument();
    });

    it('keeps the markers when the topology is slow, and recovers if it arrives', async () => {
        // The first cut of #318's fix flipped `mapFailed` on a 10s deadline,
        // which unmounted the whole map branch: focus dropped to <body>, the ten
        // city markers vanished, and because `GeographyLayer` went with them
        // `geographiesReady` could never become true again — a topology arriving
        // at t=11s was discarded for the rest of the session. A slow connection
        // lost working, clickable markers permanently.
        let resolveTopology: (value: unknown) => void = () => undefined;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => new Promise((resolve) => { resolveTopology = resolve; }),
        }) as unknown as typeof fetch;

        jest.useFakeTimers();
        try {
            const { rerender } = render(
                <TravelGuideClient cities={sampleCities} initialFavorites={[]} />
            );

            expect(screen.getByTestId('map')).toBeInTheDocument();

            await act(async () => {
                jest.advanceTimersByTime(11_000);
            });

            // It says so — and the map is still there. `status`, not `alert`:
            // the condition is transient and may clear itself.
            expect(screen.getByRole('status')).toHaveTextContent(/taking longer/i);
            expect(screen.getByTestId('map')).toBeInTheDocument();
            expect(screen.getAllByTestId('marker')).toHaveLength(sampleCities.length);

            // And it is not a one-way door: a late topology still clears it.
            await act(async () => {
                resolveTopology({ type: 'Topology', objects: {} });
                rerender(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);
            });

            expect(screen.queryByText(/taking longer/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/loading map/i)).not.toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('reports failure when the map file is unreadable', async () => {
        // jsdom exposes no `fetch`, so the probe returned early in every test
        // and this whole branch — including its precedence over the timeout —
        // was untested. The case that matters is not a 404: it is a body that
        // arrives with 200 and does not parse, which is what a CDN serving an
        // HTML error page produces, and what `react-simple-maps` swallows.
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        }) as unknown as typeof fetch;
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Wait for the failure text specifically: `findByRole('status')`
        // resolves on the loading overlay, which is already present.
        const failure = await screen.findByText(/could not be loaded/i);
        expect(failure).toBeInTheDocument();
        expect(screen.queryByText(/loading map/i)).not.toBeInTheDocument();
    });

    // The quiet sibling of the unreadable case above. An HTML error page fails
    // to parse and is handled; a JSON error body parses fine, reaches
    // `prepareFeatures`, and throws during render — a crash rather than a
    // message. A literal `null` is quieter still: it would set `topology` to
    // null and leave the panel loading forever.
    //
    // `it.each` so a failure names the body that caused it. Note what this can
    // and cannot see: `react-simple-maps` is mocked at module level here, so
    // `prepareFeatures` never runs and the crash itself is not detected — only
    // that the guard produced the failure message. The crash is reachable in a
    // real browser.
    it.each([
        ['a JSON error body', { error: 'not found' }],
        ['a literal null', null],
    ])('reports failure when map.json parses to %s', async (_label, body) => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(body),
        }) as unknown as typeof fetch;

        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);
        expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    });

    it('defers the D3 map until after client hydration', () => {
        const serverHtml = renderToString(
            <TravelGuideClient cities={sampleCities} initialFavorites={[]} />
        );

        expect(serverHtml).toContain('Loading map');
        expect(serverHtml).not.toContain('data-testid="map"');
    });

    it('renders the map, city lists, and default city sidebar details', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);
        
        expect(screen.getByTestId('map')).toBeInTheDocument();
        
        // List items
        expect(screen.getAllByText('Detroit, USA')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Paris, France')[0]).toBeInTheDocument();


        // Default city (Detroit) details should be highlighted/active
        expect(screen.getByText('Motor City')).toBeInTheDocument();
        expect(screen.getByText('Motown Museum')).toBeInTheDocument();
        expect(screen.getByText('Great music history!')).toBeInTheDocument();
    });

    it('shows one guide at a time, for the city that is selected', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Every city used to mount its own panel, all absolutely positioned at
        // the same coordinates. Only the selected one exists now (#78).
        expect(screen.getAllByRole('region')).toHaveLength(1);
        expect(screen.getByText('Motor City')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Paris, France' }));

        expect(screen.queryByText('Motor City')).not.toBeInTheDocument();
        expect(screen.getByText('City of Lights')).toBeInTheDocument();
        expect(screen.getAllByRole('region')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Paris, France' }))
            .toHaveAttribute('aria-pressed', 'true');
    });

    it('carries the review draft with the city it was typed for', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // One shared piece of state drove every mounted form, so a draft for one
        // city was the draft for all of them.
        fireEvent.change(screen.getByLabelText('Your review'), {
            target: { value: 'Half-written thought' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Paris, France' }));

        expect(screen.getByLabelText('Your review')).toHaveValue('');
    });

    it('toggles favorites successfully and reverts on API failure', async () => {
        mockToggleFavorite.mockResolvedValue({ isFavorite: true });

        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Toggle favorite for Detroit (id: 1)
        // The buttons carry a label now, rather than leaving a screen reader to
        // announce an emoji.
        fireEvent.click(screen.getByRole('button', { name: 'Add Detroit to favourites' }));

        expect(mockToggleFavorite).toHaveBeenCalledWith(1);

        // Now mock failure
        mockToggleFavorite.mockRejectedValue(new Error('Unauthorized'));
        // The label flips with the state, so re-query rather than reusing a stale handle.
        fireEvent.click(screen.getByRole('button', { name: /Detroit (to|from) favourites/ }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Please sign in to save favorites.');
            // Reverts to the filled heart, since unfavouriting failed.
            expect(screen.getByRole('button', { name: /Detroit (to|from) favourites/ }))
                .toHaveTextContent('❤️');
        });
    });

    it('shows the server validation message when a favorite mutation is rejected', async () => {
        mockToggleFavorite.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'City guide was not found.',
                fields: { cityGuideId: ['City guide was not found.'] },
            },
        });

        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);
        const favoriteButton = screen.getByRole('button', { name: 'Add Detroit to favourites' });
        fireEvent.click(favoriteButton);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('City guide was not found.');
            expect(favoriteButton).toHaveTextContent('🤍');
        });
        expect(screen.getByRole('alert')).not.toHaveTextContent('Please sign in to save favorites.');
    });



    it('submits a review successfully and shows alert on error', async () => {
        mockSubmitReview.mockResolvedValue({ id: 'new-r' });
        const mockRefresh = jest.fn();
        (useRouter as jest.Mock).mockReturnValue({ refresh: mockRefresh });

        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Find review input inside highlighted section (Detroit)
        const reviewInput = screen.getByLabelText('Your review');
        const submitButton = screen.getByRole('button', { name: 'Submit Review' });

        fireEvent.change(reviewInput, { target: { value: 'Awesome city!' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockSubmitReview).toHaveBeenCalledWith(1, 5, 'Awesome city!');
            expect(mockRefresh).toHaveBeenCalled();
            // Verify input is cleared on success
            expect(reviewInput).toHaveValue('');
        });

        // Submit error flow
        mockSubmitReview.mockRejectedValue(new Error('Unauthorized'));
        fireEvent.change(reviewInput, { target: { value: 'Fails' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Please sign in to submit a review.');
            // Verify input is preserved on error
            expect(reviewInput).toHaveValue('Fails');
        });
    });



    it('returns to the list, and says what to do next', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '← All destinations' }));

        expect(screen.queryByText('Motor City')).not.toBeInTheDocument();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
        expect(screen.getByText(/Choose a destination/i)).toBeInTheDocument();
    });

    it('selects a city from the keyboard', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // The map answered only to a mouse, which made it a decoration for
        // anyone not using one.
        const parisMarker = screen.getByRole('button', {
            name: 'Show the guide for Paris, France',
        });
        fireEvent.keyDown(parisMarker, { key: 'Enter' });

        expect(screen.getByText('City of Lights')).toBeInTheDocument();
        expect(parisMarker).toHaveAttribute('aria-pressed', 'true');
    });

    it('says so when there are no guides at all', () => {
        render(<TravelGuideClient cities={[]} initialFavorites={[]} />);

        expect(screen.getByText('No destination guides yet.')).toBeInTheDocument();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('triggers marker click, rating change, card favorite click, and ignores empty reviews', async () => {

        mockToggleFavorite.mockResolvedValue({ isFavorite: true });
        
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // 1. Marker click
        const markers = screen.getAllByTestId('marker');
        fireEvent.click(markers[1]); // Click Paris marker
        expect(screen.getByText('City of Lights')).toBeInTheDocument();

        // 2. Rating change on Paris (active card)
        const ratingSelect = screen.getByLabelText('Your rating');
        fireEvent.change(ratingSelect, { target: { value: '4' } });
        expect(ratingSelect).toHaveValue('4');

        // 3. Card-level favorite click on Paris
        const cardFavoriteButton = screen.getByRole('button', { name: '🤍 Favorite' });
        fireEvent.click(cardFavoriteButton);
        expect(mockToggleFavorite).toHaveBeenCalledWith(2);

        // 4. Ignore empty review submit
        const submitButton = screen.getByRole('button', { name: 'Submit Review' });
        fireEvent.click(submitButton);
        expect(mockSubmitReview).not.toHaveBeenCalled();
    });
});

describe('the travel guide map, as assistive technology and a keyboard meet it', () => {
    it('keeps the decorative country outlines out of the tab order', async () => {
        const realFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ type: 'Topology', objects: {} }),
        }) as unknown as typeof fetch;
        try {
            render(
                <TravelGuideClient
                    cities={sampleCities as never}
                    initialFavorites={[]}
                />
            );

            // The outlines exist only once the topology has been fetched and parsed:
            // the component owns that request now and passes the object down.
            await screen.findAllByTestId('geography');

            // `react-simple-maps` renders every country as a focusable `path` with no
            // accessible name and no role. There are 202 of them on the real map and
            // 176 are clipped outside the viewBox, so a keyboard user reached the first
            // city marker on tab stop 209 having passed 202 stops that announce nothing
            // and cannot be seen. The interactive things here are the markers.
            for (const outline of screen.getAllByTestId('geography')) {
                expect(outline).toHaveAttribute('tabindex', '-1');
                expect(outline).toHaveAttribute('aria-hidden', 'true');
            }
        } finally {
            global.fetch = realFetch;
        }
    });
});

describe('selecting a city', () => {
    let scrollIntoView: jest.SpyInstance;

    beforeEach(() => {
        scrollIntoView = jest
            .spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        scrollIntoView.mockRestore();
    });

    it('brings its panel into view, because stacked it is a screen away', () => {
        render(
            <TravelGuideClient
                cities={sampleCities as never}
                initialFavorites={[]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Paris, France' }));

        // Stacked, the detail panel renders below a ten-item list and lands about
        // 1200px past the fold, so selecting a city changed nothing a customer
        // could see. `nearest` scrolls the least it can, and nothing at all when
        // the panel is already visible -- which is the desktop case this must not
        // yank around.
        expect(scrollIntoView).toHaveBeenCalledWith(
            expect.objectContaining({ block: 'nearest' }),
        );
    });

    it('reveals the panel even when the city is already selected', () => {
        render(
            <TravelGuideClient
                cities={sampleCities as never}
                initialFavorites={[]}
            />
        );

        // Detroit is selected on mount, so this is the most likely first tap on a
        // phone -- and it sets identical state, which React bails out of. An effect
        // keyed on the selection therefore never ran, and the panel 1200px below the
        // fold stayed there.
        fireEvent.click(screen.getByRole('button', { name: 'Detroit, USA' }));

        expect(scrollIntoView).toHaveBeenCalledWith(
            expect.objectContaining({ block: 'nearest' }),
        );
    });

    it('moves focus to the panel it scrolled to', () => {
        render(
            <TravelGuideClient
                cities={sampleCities as never}
                initialFavorites={[]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Paris, France' }));

        // Scrolling alone left focus on the control the customer had just pressed,
        // now off-screen above, so the next Tab scrolled back up and the panel could
        // not be operated by keyboard. Moving focus is also the only thing here that
        // announces the change.
        expect(screen.getByRole('region', { name: 'Paris guide' })).toHaveFocus();
    });

    it('does not scroll the page on load', () => {
        render(
            <TravelGuideClient
                cities={sampleCities as never}
                initialFavorites={[]}
            />
        );

        // A city is selected on mount, so an effect keyed only on the selection
        // fires immediately and scrolled the page under a customer who had just
        // arrived and asked for nothing.
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('does not scroll when the selection is cleared', () => {
        render(
            <TravelGuideClient
                cities={sampleCities as never}
                initialFavorites={[]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Paris, France' }));
        scrollIntoView.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /All destinations/ }));

        // Going back to the list is not a selection, and scrolling somewhere on the
        // way out would move the page under a customer who just asked to leave.
        expect(scrollIntoView).not.toHaveBeenCalled();
    });
});
