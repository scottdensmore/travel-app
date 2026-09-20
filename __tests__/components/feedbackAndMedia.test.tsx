import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileClient from '@/components/ui/ProfileClient';
import FlightStatusSelector from '@/app/admin/flights/FlightStatusSelector';
import DeleteGuideButton from '@/app/admin/travelguide/DeleteGuideButton';
import TravelGuideClient from '@/components/ui/TravelGuideClient';
import TravelGuideForm from '@/components/ui/travelGuideForm';
import {
    cancelBookingAction,
    retryBookingRefundAction,
    deleteReviewAction,
    toggleFavoriteCityGuideAction,
    updateFlightStatusAction,
    deleteCityGuideAction,
} from '@/app/actions';
import { actionValidationFailure } from '@/lib/actionResult';
import { useRouter } from 'next/navigation';

global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
}));

jest.mock('@/app/actions', () => ({
    cancelBookingAction: jest.fn(),
    retryBookingRefundAction: jest.fn(),
    deleteReviewAction: jest.fn(),
    toggleFavoriteCityGuideAction: jest.fn(),
    updateFlightStatusAction: jest.fn(),
    deleteCityGuideAction: jest.fn(),
    changeBookingSeatsAction: jest.fn(),
    getOccupiedSeatsAction: jest.fn().mockResolvedValue([]),
    saveCityGuideAction: jest.fn(),
}));

jest.mock('@/components/ui/charts/nextStatusChart', () => () => <div data-testid="status-chart" />);
jest.mock('@/components/ui/charts/pointsHistoryChart', () => () => <div data-testid="history-chart" />);

jest.mock('react-simple-maps', () => ({
    ComposableMap: ({ children }: any) => <svg data-testid="map">{children}</svg>,
    Geographies: ({ children }: any) => children({ geographies: [{ rsmKey: '1' }] }),
    Geography: () => <path data-testid="geography" />,
    Marker: ({ children, onClick }: any) => <g onClick={onClick} data-testid="marker">{children}</g>,
}));

const mockCancelBooking = cancelBookingAction as jest.Mock;
const mockRetryBookingRefund = retryBookingRefundAction as jest.Mock;
const mockDeleteReview = deleteReviewAction as jest.Mock;
const mockToggleFavorite = toggleFavoriteCityGuideAction as jest.Mock;
const mockUpdateFlightStatus = updateFlightStatusAction as jest.Mock;
const mockDeleteCityGuide = deleteCityGuideAction as jest.Mock;

const sampleBookings = [
    {
        id: 101,
        reference: 'MA-11111111111111111111',
        createdAt: '2026-06-01T10:00:00Z',
        status: 'CONFIRMED',
        totalPriceCents: 35000,
        flightId: 201,
        legs: [{
            id: 501,
            sequence: 1,
            flight: {
                id: 201,
                flightNumber: 'GA101',
                airline: 'Gemini Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-06-15T08:00:00Z',
                returnDate: null,
                priceCents: 35000,
            },
            seatAssignments: [
                { passengerId: 'p-1', seatNumber: '12A', cabinClass: 'ECONOMY' }
            ],
        }],
        passengers: [
            {
                id: 'p-1',
                firstName: 'Jane',
                lastName: 'Doe',
                dateOfBirth: '1990-01-01',
                passportNumber: 'P12345',
                gender: 'Female',
            }
        ]
    }
];

const sampleCancelledBooking = {
    id: 102,
    reference: 'MA-22222222222222222222',
    createdAt: '2026-06-01T10:00:00Z',
    status: 'CANCELLED',
    totalPriceCents: 20000,
    flightId: 202,
    legs: [{
        id: 502,
        sequence: 1,
        flight: {
            id: 202,
            flightNumber: 'GA102',
            airline: 'Gemini Airways',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2026-06-16T08:00:00Z',
            returnDate: null,
            priceCents: 20000,
        },
        seatAssignments: [],
    }],
    passengers: [
        {
            id: 'p-1',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: '1990-01-01',
            passportNumber: 'P12345',
            gender: 'Female',
        }
    ],
    statusChanges: [{
        refundCents: 20000,
        paymentRefund: { status: 'FAILED' as const, amountCents: 20000 },
    }],
};

const sampleFavorites = [
    {
        id: 'fav-1',
        cityGuideId: 5,
        cityGuide: {
            id: 5,
            city: 'Detroit',
            country: 'USA',
            description: 'Motor City',
            coverImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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

describe('Issue #81: Standardized feedback and media elements', () => {
    const mockRefresh = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({ refresh: mockRefresh });
        global.confirm = jest.fn().mockReturnValue(true);
        global.alert = jest.fn();
    });

    describe('ProfileClient inline feedback', () => {
        it('displays inline error alert on failed booking cancellation without calling window.alert', async () => {
            mockCancelBooking.mockResolvedValue(
                actionValidationFailure('Flight has already departed and cannot be cancelled.')
            );

            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={sampleBookings}
                    favorites={[]}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
            fireEvent.click(cancelBtn);

            await waitFor(() => {
                expect(mockCancelBooking).toHaveBeenCalledWith(101);
            });

            const alertNotice = await screen.findByRole('alert');
            expect(alertNotice).toHaveTextContent('Flight has already departed and cannot be cancelled.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert on booking cancellation network error without calling window.alert', async () => {
            mockCancelBooking.mockRejectedValue(new Error('Network error'));

            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={sampleBookings}
                    favorites={[]}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
            fireEvent.click(cancelBtn);

            await waitFor(() => {
                expect(mockCancelBooking).toHaveBeenCalledWith(101);
            });

            const alertNotice = await screen.findByRole('alert');
            expect(alertNotice).toHaveTextContent('Failed to cancel booking. Please try again.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert on failed refund retry without calling window.alert', async () => {
            mockRetryBookingRefund.mockResolvedValue(
                actionValidationFailure('Refund gateway timeout. Please retry.')
            );

            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={[sampleCancelledBooking]}
                    favorites={[]}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const retryBtn = screen.getByRole('button', { name: /retry refund/i });
            fireEvent.click(retryBtn);

            await waitFor(() => {
                expect(mockRetryBookingRefund).toHaveBeenCalledWith(102);
            });

            const alertNotice = await screen.findByRole('alert');
            expect(alertNotice).toHaveTextContent('Refund gateway timeout. Please retry.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert on refund retry network exception without calling window.alert', async () => {
            mockRetryBookingRefund.mockRejectedValue(new Error('Network failure'));

            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={[sampleCancelledBooking]}
                    favorites={[]}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const retryBtn = screen.getByRole('button', { name: /retry refund/i });
            fireEvent.click(retryBtn);

            await waitFor(() => {
                expect(mockRetryBookingRefund).toHaveBeenCalledWith(102);
            });

            const alertNotice = await screen.findByRole('alert');
            expect(alertNotice).toHaveTextContent('Your refund is still pending. Please try again later.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert on failed review delete without calling window.alert', async () => {
            mockDeleteReview.mockRejectedValue(new Error('Failed to delete review. Please try again.'));

            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={[]}
                    favorites={[]}
                    reviews={sampleReviews}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const deleteReviewBtn = screen.getByRole('button', { name: 'Delete review' });
            fireEvent.click(deleteReviewBtn);

            await waitFor(() => {
                expect(mockDeleteReview).toHaveBeenCalledWith('rev-1');
            });

            const alertNotice = await screen.findByRole('alert');
            expect(alertNotice).toHaveTextContent('Failed to delete review. Please try again.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert on failed favorite toggle without calling window.alert', async () => {
            mockToggleFavorite.mockRejectedValue(new Error('Failed to update favorite. Please try again.'));

            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={[]}
                    favorites={sampleFavorites}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const unfavoriteBtn = screen.getByRole('button', { name: 'Unfavorite Detroit' });
            fireEvent.click(unfavoriteBtn);

            await waitFor(() => {
                expect(mockToggleFavorite).toHaveBeenCalledWith(5);
            });

            const alertNotice = await screen.findByRole('alert');
            expect(alertNotice).toHaveTextContent('Failed to update favorite. Please try again.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('renders user avatar and favorite cover with Next.js Image components', () => {
            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="/avatar.png"
                    accountTimeZone="UTC"
                    accountTimeZoneChoices={['UTC']}
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={[]}
                    favorites={sampleFavorites}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

            const avatarImg = screen.getByAltText('User avatar');
            expect(avatarImg).toBeInTheDocument();
            expect(avatarImg).toHaveAttribute('width', '48');
            expect(avatarImg).toHaveAttribute('height', '48');

            const favoriteCoverImg = screen.getByAltText('Detroit');
            expect(favoriteCoverImg).toBeInTheDocument();
            expect(favoriteCoverImg).toHaveAttribute('width', '300');
            expect(favoriteCoverImg).toHaveAttribute('height', '120');
        });
    });

    describe('FlightStatusSelector inline feedback', () => {
        it('displays inline error alert without calling window.alert on validation failure', async () => {
            mockUpdateFlightStatus.mockResolvedValue(
                actionValidationFailure('Unauthorized status transition.')
            );

            render(<FlightStatusSelector id={201} currentStatus="ON_TIME" />);

            const select = screen.getByRole('combobox');
            expect(select).not.toHaveAttribute('aria-invalid', 'true');

            fireEvent.change(select, { target: { value: 'CANCELLED' } });

            await waitFor(() => {
                expect(mockUpdateFlightStatus).toHaveBeenCalledWith(201, 'CANCELLED');
            });

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Unauthorized status transition.');
            expect(select).toHaveAttribute('aria-invalid', 'true');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert without calling window.alert on network rejection', async () => {
            mockUpdateFlightStatus.mockRejectedValue(new Error('Network failure.'));

            render(<FlightStatusSelector id={201} currentStatus="ON_TIME" />);

            const select = screen.getByRole('combobox');
            fireEvent.change(select, { target: { value: 'DELAYED' } });

            await waitFor(() => {
                expect(mockUpdateFlightStatus).toHaveBeenCalledWith(201, 'DELAYED');
            });

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Network failure.');
            expect(select).toHaveAttribute('aria-invalid', 'true');
            expect(global.alert).not.toHaveBeenCalled();
        });
    });

    describe('DeleteGuideButton inline feedback', () => {
        it('displays inline error alert without calling window.alert on validation failure', async () => {
            mockDeleteCityGuide.mockResolvedValue(
                actionValidationFailure('Cannot delete guide with active bookings.')
            );

            render(<DeleteGuideButton id={5} />);

            const button = screen.getByRole('button', { name: 'Delete' });
            fireEvent.click(button);

            await waitFor(() => {
                expect(mockDeleteCityGuide).toHaveBeenCalledWith(5);
            });

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Cannot delete guide with active bookings.');
            expect(global.alert).not.toHaveBeenCalled();
        });

        it('displays inline error alert without calling window.alert on network error', async () => {
            mockDeleteCityGuide.mockRejectedValue(new Error('Server error during deletion.'));

            render(<DeleteGuideButton id={5} />);

            const button = screen.getByRole('button', { name: 'Delete' });
            fireEvent.click(button);

            await waitFor(() => {
                expect(mockDeleteCityGuide).toHaveBeenCalledWith(5);
            });

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Server error during deletion.');
            expect(global.alert).not.toHaveBeenCalled();
        });
    });

    describe('TravelGuide media components', () => {
        it('renders reviewer avatar via Next.js Image with proper dimensions in TravelGuideClient', async () => {
            const cities = [
                {
                    id: 1,
                    city: 'Detroit',
                    country: 'USA',
                    latlong: [42.3314, -83.0458],
                    description: 'Motor City',
                    highlights: ['Motown Museum'],
                    coverImage: null,
                    reviews: [
                        {
                            id: 'r1',
                            content: 'Great tour!',
                            rating: 5,
                            user: { name: 'Alice Traveler', image: 'https://example.com/avatar.jpg' }
                        }
                    ]
                }
            ];

            render(<TravelGuideClient cities={cities} initialFavorites={[]} />);

            const avatarImg = screen.getByAltText('Alice Traveler');
            expect(avatarImg).toBeInTheDocument();
            expect(avatarImg).toHaveAttribute('width', '32');
            expect(avatarImg).toHaveAttribute('height', '32');
        });

        it('renders cover image preview via Next.js Image in TravelGuideForm', async () => {
            const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const dummyFileReader = {
                readAsDataURL: jest.fn().mockImplementation(function(this: any) {
                    this.result = validPngDataUrl;
                    if (this.onloadend) this.onloadend();
                }),
                onloadend: null as any,
                result: '',
            };
            const originalFileReader = global.FileReader;
            global.FileReader = jest.fn().mockImplementation(() => dummyFileReader) as any;

            render(<TravelGuideForm />);

            const file = new File(['valid-image-data'], 'preview.png', { type: 'image/png' });
            const input = screen.getByLabelText(/Cover Image:/i);

            fireEvent.change(input, { target: { files: [file] } });

            const previewImg = await screen.findByAltText('Cover Preview');
            expect(previewImg).toBeInTheDocument();
            expect(previewImg).toHaveAttribute('width', '320');
            expect(previewImg).toHaveAttribute('height', '180');

            global.FileReader = originalFileReader;
        });
    });
});
