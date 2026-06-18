import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TravelGuideClient from '@/components/ui/TravelGuideClient';
import { toggleFavoriteCityGuideAction, submitCityGuideReviewAction } from '@/app/actions';
import { useRouter } from 'next/navigation';

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

    it('switches the active city guide when clicking on another city marker or header', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Click on Paris header in the list
        const parisHeader = screen.getAllByRole('heading', { name: 'Paris, France' })[0];
        fireEvent.click(parisHeader);

        // Detroit details should no longer be the active highlight (represented by class highlight)
        const detroitDetails = screen.getByText('Motor City').closest('.guide-extra');
        expect(detroitDetails).not.toHaveClass('highlight');


        const parisDetails = screen.getByText('City of Lights').closest('.guide-extra');
        expect(parisDetails).toHaveClass('highlight');
    });

    it('toggles favorites successfully and reverts on API failure', async () => {
        mockToggleFavorite.mockResolvedValue({ isFavorite: true });

        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Toggle favorite for Detroit (id: 1)
        const favoriteButtons = screen.getAllByRole('button', { name: '🤍' });
        fireEvent.click(favoriteButtons[0]);

        expect(mockToggleFavorite).toHaveBeenCalledWith(1);

        // Now mock failure
        mockToggleFavorite.mockRejectedValue(new Error('Unauthorized'));
        fireEvent.click(favoriteButtons[0]);

        await waitFor(() => {
            expect(global.alert).toHaveBeenCalledWith('Please sign in to save favorites.');
            // Verify favorite reverts to filled heart (since unfavoriting failed)
            expect(favoriteButtons[0]).toHaveTextContent('❤️');
        });
    });



    it('submits a review successfully and shows alert on error', async () => {
        mockSubmitReview.mockResolvedValue({ id: 'new-r' });
        const mockRefresh = jest.fn();
        (useRouter as jest.Mock).mockReturnValue({ refresh: mockRefresh });

        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // Find review input inside highlighted section (Detroit)
        const reviewInput = screen.getAllByPlaceholderText('Share your experience...')[0];
        const submitButton = screen.getAllByRole('button', { name: 'Submit Review' })[0];

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
            expect(global.alert).toHaveBeenCalledWith('Please sign in to submit a review.');
            // Verify input is preserved on error
            expect(reviewInput).toHaveValue('Fails');
        });
    });



    it('resets selection when clicking back link', () => {
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        const backLink = screen.getAllByText('← Back')[0];
        fireEvent.click(backLink);

        const detroitDetails = screen.getByText('Motor City').closest('.guide-extra');
        expect(detroitDetails).not.toHaveClass('highlight');
    });

    it('triggers marker click, rating change, card favorite click, and ignores empty reviews', async () => {

        mockToggleFavorite.mockResolvedValue({ isFavorite: true });
        
        render(<TravelGuideClient cities={sampleCities} initialFavorites={[]} />);

        // 1. Marker click
        const markers = screen.getAllByTestId('marker');
        fireEvent.click(markers[1]); // Click Paris marker
        const parisDetails = screen.getByText('City of Lights').closest('.guide-extra');
        expect(parisDetails).toHaveClass('highlight');

        // 2. Rating change on Paris (active card)
        const ratingSelects = screen.getAllByRole('combobox');
        fireEvent.change(ratingSelects[1], { target: { value: '4' } }); // Paris rating select is 1st (as Detroit is 0th)
        expect(ratingSelects[1]).toHaveValue('4');

        // 3. Card-level favorite click on Paris
        const cardFavoriteButton = screen.getAllByRole('button', { name: '🤍 Favorite' })[1];
        fireEvent.click(cardFavoriteButton);
        expect(mockToggleFavorite).toHaveBeenCalledWith(2);

        // 4. Ignore empty review submit
        const submitButton = screen.getAllByRole('button', { name: 'Submit Review' })[1]; // Paris submit button
        fireEvent.click(submitButton);
        expect(mockSubmitReview).not.toHaveBeenCalled();
    });
});


