import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

jest.mock('react-simple-maps', () => ({
    ComposableMap: ({ children }: any) => <svg data-testid="map">{children}</svg>,
    Geographies: ({ children }: any) => children({ geographies: [{ rsmKey: '1' }] }),
    Geography: () => <path data-testid="geography" />,
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
    beforeEach(() => {
        jest.clearAllMocks();
        global.alert = jest.fn();
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
