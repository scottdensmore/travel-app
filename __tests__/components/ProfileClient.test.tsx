import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileClient from '@/components/ui/ProfileClient';
import { cancelBookingAction, deleteReviewAction, toggleFavoriteCityGuideAction } from '@/app/actions';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
    useRouter: jest.fn().mockReturnValue({
        refresh: jest.fn(),
    }),
}));

jest.mock('@/app/actions', () => ({
    cancelBookingAction: jest.fn(),
    deleteReviewAction: jest.fn(),
    toggleFavoriteCityGuideAction: jest.fn(),
}));

jest.mock('@/components/ui/charts/nextStatusChart', () => () => <div data-testid="status-chart" />);
jest.mock('@/components/ui/charts/pointsHistoryChart', () => () => <div data-testid="history-chart" />);

const mockCancelBooking = cancelBookingAction as jest.Mock;
const mockDeleteReview = deleteReviewAction as jest.Mock;
const mockToggleFavorite = toggleFavoriteCityGuideAction as jest.Mock;

const sampleBookings = [
    {
        id: 101,
        createdAt: '2026-06-01T10:00:00Z',
        flight: {
            id: 201,
            flightNumber: 'GA101',
            airline: 'Gemini Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate: '2026-06-15T08:00:00Z',
            returnDate: null,
            price: '$350',
        }
    }
];

const sampleFavorites = [
    {
        id: 'fav-1',
        cityGuideId: 5,
        cityGuide: {
            id: 5,
            city: 'Detroit',
            country: 'USA',
            description: 'Motor City',
            coverImage: null,
        }
    }
];

const sampleReviews = [
    {
        id: 'rev-1',
        content: 'Loved the music history!',
        rating: 5,
        cityGuide: {
            id: 5,
            city: 'Detroit',
            country: 'USA',
            description: 'Motor City',
            coverImage: null,
        },
        createdAt: '2026-06-02T12:00:00Z',
    }
];

describe('ProfileClient interactive dashboard', () => {
    const mockRefresh = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({ refresh: mockRefresh });
        global.confirm = jest.fn().mockReturnValue(true);
        global.alert = jest.fn();
    });

    it('renders profile fields, charts, bookings, favorites, and reviews', () => {
        render(
            <ProfileClient
                userName="Jane Doe"
                userAvatar="avatar.png"
                currentStatus="Gold"
                currentPoints={4200}
                bookings={sampleBookings}
                favorites={sampleFavorites}
                reviews={sampleReviews}
                activityData={[]}
                monthlyHistory={[]}
            />
        );

        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText('Gold')).toBeInTheDocument();
        expect(screen.getByText('4,200')).toBeInTheDocument();
        expect(screen.getByTestId('status-chart')).toBeInTheDocument();
        expect(screen.getByTestId('history-chart')).toBeInTheDocument();

        // Bookings
        expect(screen.getByText('Gemini Airways GA101')).toBeInTheDocument();
        // Favorites
        expect(screen.getAllByText('Detroit')[0]).toBeInTheDocument();

        // Reviews
        expect(screen.getByText('Loved the music history!')).toBeInTheDocument();
    });

    it('handles canceling a booking on user confirmation', async () => {
        mockCancelBooking.mockResolvedValue({ id: 101 });
        render(
            <ProfileClient
                userName="Jane Doe"
                userAvatar="avatar.png"
                currentStatus="Gold"
                currentPoints={4200}
                bookings={sampleBookings}
                favorites={[]}
                reviews={[]}
                activityData={[]}
                monthlyHistory={[]}
            />
        );

        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelBtn);

        expect(global.confirm).toHaveBeenCalledWith('Are you sure you want to cancel booking for flight GA101?');
        await waitFor(() => {
            expect(mockCancelBooking).toHaveBeenCalledWith(101);
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('handles removing a favorite', async () => {
        mockToggleFavorite.mockResolvedValue({ isFavorite: false });
        render(
            <ProfileClient
                userName="Jane Doe"
                userAvatar="avatar.png"
                currentStatus="Gold"
                currentPoints={4200}
                bookings={[]}
                favorites={sampleFavorites}
                reviews={[]}
                activityData={[]}
                monthlyHistory={[]}
            />
        );

        const unfavoriteBtn = screen.getByRole('button', { name: 'Unfavorite Detroit' });
        fireEvent.click(unfavoriteBtn);

        await waitFor(() => {
            expect(mockToggleFavorite).toHaveBeenCalledWith(5);
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('handles deleting a review on user confirmation', async () => {
        mockDeleteReview.mockResolvedValue({ id: 'rev-1' });
        render(
            <ProfileClient
                userName="Jane Doe"
                userAvatar="avatar.png"
                currentStatus="Gold"
                currentPoints={4200}
                bookings={[]}
                favorites={[]}
                reviews={sampleReviews}
                activityData={[]}
                monthlyHistory={[]}
            />
        );

        const deleteBtn = screen.getByRole('button', { name: 'Delete review' });
        fireEvent.click(deleteBtn);

        expect(global.confirm).toHaveBeenCalledWith('Are you sure you want to delete this review?');
        await waitFor(() => {
            expect(mockDeleteReview).toHaveBeenCalledWith('rev-1');
            expect(mockRefresh).toHaveBeenCalled();
        });
    });
});
