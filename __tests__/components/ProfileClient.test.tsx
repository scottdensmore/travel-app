import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileClient from '@/components/ui/ProfileClient';
import { cancelBookingAction, deleteReviewAction, toggleFavoriteCityGuideAction, changeBookingSeatsAction, getOccupiedSeatsAction } from '@/app/actions';
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
    changeBookingSeatsAction: jest.fn(),
    getOccupiedSeatsAction: jest.fn(),
}));

jest.mock('@/components/ui/charts/nextStatusChart', () => () => <div data-testid="status-chart" />);
jest.mock('@/components/ui/charts/pointsHistoryChart', () => () => <div data-testid="history-chart" />);

const mockCancelBooking = cancelBookingAction as jest.Mock;
const mockDeleteReview = deleteReviewAction as jest.Mock;
const mockToggleFavorite = toggleFavoriteCityGuideAction as jest.Mock;
const mockChangeBookingSeats = changeBookingSeatsAction as jest.Mock;
const mockGetOccupiedSeats = getOccupiedSeatsAction as jest.Mock;

const sampleBookings = [
    {
        id: 101,
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
            // Where the traveller sits on this leg, and the cabin they hold
            // there. The traveller record carries neither (#137).
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
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
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
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
            />
        );

        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelBtn);

        expect(global.confirm).toHaveBeenCalledWith('Are you sure you want to cancel booking for flight GA101? This will release your seats.');
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
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
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
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
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

    it('handles changing seats for passengers interactively', async () => {
        mockGetOccupiedSeats.mockResolvedValue(['11B', '11C']);
        mockChangeBookingSeats.mockResolvedValue({ id: 101 });

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
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
            />
        );

        // Click Change Seats button
        const changeSeatsBtn = screen.getByRole('button', { name: 'Change Seats' });
        fireEvent.click(changeSeatsBtn);

        // Check if modal title is present
        expect(screen.getByRole('heading', { name: 'Change Seats' })).toBeInTheDocument();

        // Choose open seat 11A for active passenger Jane (whose original seat is 12A)
        // Using findByTitle waits for the state update from mockGetOccupiedSeats to apply
        const seat11A = await screen.findByTitle('Select Seat 11A');
        
        // 11B should be occupied (red / disabled). Awaited because occupancy for
        // every leg is loaded together and lands a tick after the map renders.
        const seat11B = await screen.findByTitle('Seat 11B Occupied');
        expect(seat11B).toBeDisabled();

        fireEvent.click(seat11A);

        // Save
        const saveBtn = screen.getByRole('button', { name: 'Save New Seats' });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockChangeBookingSeats).toHaveBeenCalledWith(101, [
                { passengerId: 'p-1', legId: 501, seatNumber: '11A' }
            ]);
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('uses accessible passenger selectors and announces seat validation errors', async () => {
        mockGetOccupiedSeats.mockResolvedValue([]);
        mockChangeBookingSeats.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Choose a valid seat.',
                fields: { 'seatChanges.0.seatNumber': ['Choose a valid seat.'] },
            },
        });

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
                renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Change Seats' }));
        const passengerSelector = await screen.findByRole('button', { name: /Jane Doe.*Seat: 12A/i });
        expect(passengerSelector).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Save New Seats' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid seat.');
    });

    describe('Round-trip bookings', () => {
        const roundTripBooking = {
            ...sampleBookings[0],
            id: 202,
            totalPriceCents: 66000,
            legs: [
                {
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
                    seatAssignments: [{ passengerId: 'p-1', seatNumber: '12A' }],
                },
                {
                    id: 502,
                    sequence: 2,
                    flight: {
                        id: 202,
                        flightNumber: 'GA900',
                        airline: 'Gemini Airways',
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        departureDate: '2026-06-22T17:00:00Z',
                        returnDate: null,
                        priceCents: 31000,
                    },
                    seatAssignments: [{ passengerId: 'p-1', seatNumber: '4C' }],
                },
            ],
        };

        const renderBookings = (bookings: unknown[]) =>
            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="avatar.png"
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={bookings as never}
                    favorites={[]}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-06-01T00:00:00Z').getTime()}
                />
            );

        it('lists every leg of the itinerary, in order', () => {
            renderBookings([roundTripBooking]);

            const row = screen.getByTestId('booking-row-202');
            expect(row).toHaveTextContent('Gemini Airways GA101');
            expect(row).toHaveTextContent('Gemini Airways GA900');
            expect(row).toHaveTextContent('Seattle, USA → Detroit, USA');
            expect(row).toHaveTextContent('Detroit, USA → Seattle, USA');

            // Order follows the itinerary, not the order rows happen to arrive.
            const legs = within(row).getAllByTestId(/^booking-leg-/);
            expect(legs).toHaveLength(2);
            expect(legs[0]).toHaveTextContent('GA101');
            expect(legs[1]).toHaveTextContent('GA900');
        });

        it('shows the seat held on each leg rather than one seat for the trip', () => {
            renderBookings([roundTripBooking]);

            const legs = within(screen.getByTestId('booking-row-202')).getAllByTestId(/^booking-leg-/);
            expect(legs[0]).toHaveTextContent('Jane (12A)');
            expect(legs[1]).toHaveTextContent('Jane (4C)');
        });

        it('labels a two-leg trip as a round trip and a single leg as one way', () => {
            renderBookings([roundTripBooking]);
            expect(screen.getByTestId('booking-row-202')).toHaveTextContent(/round trip/i);

            cleanup();
            renderBookings([sampleBookings[0]]);
            expect(screen.getByTestId('booking-row-101')).toHaveTextContent(/one way/i);
        });

        it('names the cabin in the seat modal the way the ticket does', async () => {
            // The modal read the cabin off the seat assignment and printed it
            // raw, so a customer's own booking showed "(PREMIUM_ECONOMY)" — the
            // same defect as the boarding pass, in the place #169 missed.
            mockGetOccupiedSeats.mockResolvedValue([]);
            const premium = {
                ...roundTripBooking,
                id: 204,
                legs: roundTripBooking.legs.map(leg => ({
                    ...leg,
                    seatAssignments: [
                        { passengerId: 'p-1', seatNumber: '12A', cabinClass: 'PREMIUM_ECONOMY' },
                    ],
                })),
            };
            renderBookings([premium]);

            fireEvent.click(screen.getAllByRole('button', { name: 'Change Seats' })[0]);

            expect(await screen.findByText(/\(Premium Economy\)/)).toBeInTheDocument();
            expect(screen.queryByText(/PREMIUM_ECONOMY/)).not.toBeInTheDocument();
        });

        it('names the legs the way checkout does, including a middle one', async () => {
            // Both screens labelled legs from their own copy of
            // `index === 0 ? 'Departing' : 'Returning'`. They agreed only
            // because MAX_ITINERARY_LEGS is 2; connecting itineraries (#131)
            // would have had the profile call leg 2 of 3 "Returning" while
            // checkout called it "Leg 2" (#160).
            mockGetOccupiedSeats.mockResolvedValue([]);
            const threeLegBooking = {
                ...roundTripBooking,
                id: 203,
                legs: [
                    roundTripBooking.legs[0],
                    {
                        ...roundTripBooking.legs[1],
                        id: 503,
                        sequence: 2,
                        flight: { ...roundTripBooking.legs[1].flight, id: 203, flightNumber: 'GA500' },
                    },
                    { ...roundTripBooking.legs[1], id: 504, sequence: 3 },
                ],
            };
            renderBookings([threeLegBooking]);

            fireEvent.click(screen.getAllByRole('button', { name: 'Change Seats' })[0]);
            const tabs = screen.getByTestId('seat-change-legs').querySelectorAll('[role="tab"]');

            expect(tabs).toHaveLength(3);
            expect(tabs[0]).toHaveTextContent('Departing');
            expect(tabs[1]).toHaveTextContent('Leg 2');
            expect(tabs[2]).toHaveTextContent('Returning');
        });

        it('changes the seat on the chosen leg and leaves the other alone', async () => {
            mockGetOccupiedSeats.mockResolvedValue([]);
            mockChangeBookingSeats.mockResolvedValue({ id: 202 });
            renderBookings([roundTripBooking]);

            fireEvent.click(screen.getAllByRole('button', { name: 'Change Seats' })[0]);
            const tabs = screen.getByTestId('seat-change-legs').querySelectorAll('[role="tab"]');
            expect(tabs).toHaveLength(2);

            // The card shows the seat held on the leg being looked at.
            expect(await screen.findByRole('button', { name: /Jane Doe.*Seat: 12A/i })).toBeInTheDocument();
            fireEvent.click(tabs[1]);
            expect(screen.getByRole('button', { name: /Jane Doe.*Seat: 4C/i })).toBeInTheDocument();

            // Move only the return seat.
            fireEvent.click(await screen.findByTitle('Select Seat 13D'));
            fireEvent.click(screen.getByRole('button', { name: 'Save New Seats' }));

            await waitFor(() => {
                expect(mockChangeBookingSeats).toHaveBeenCalledWith(202, [
                    { passengerId: 'p-1', legId: 501, seatNumber: '12A' },
                    { passengerId: 'p-1', legId: 502, seatNumber: '13D' },
                ]);
            });
        });

        it('reports a leg with no assignment rather than borrowing a seat', () => {
            // The fallback to Passenger.seatNumber described the outbound leg,
            // so on any other leg it showed a seat the traveller does not hold.
            // An absent assignment is a defect and now reads as one (#137).
            renderBookings([
                {
                    ...roundTripBooking,
                    legs: roundTripBooking.legs.map(leg => ({ ...leg, seatAssignments: [] })),
                },
            ]);

            const legs = within(screen.getByTestId('booking-row-202')).getAllByTestId(/^booking-leg-/);
            expect(legs[0]).toHaveTextContent('Jane (Not assigned)');
            expect(legs[0]).not.toHaveTextContent('12A');
        });

        /** The inbound is the one the airline cancelled. */
        const disruptedRoundTrip = {
            ...roundTripBooking,
            status: 'DISRUPTED',
            legs: roundTripBooking.legs.map((leg, index) => ({
                ...leg,
                flight: { ...leg.flight, status: index === 1 ? 'CANCELLED' : 'ON_TIME' },
            })),
        };

        it('names the leg the airline cancelled, not whichever came first', () => {
            // The status cell sits beside leg 1, so it used to mark the
            // outbound whatever had actually been cancelled -- telling a
            // customer their departing flight was off when it was the return.
            renderBookings([disruptedRoundTrip]);

            const row = screen.getByTestId('booking-row-202');
            expect(row).toHaveTextContent('GA900 cancelled by airline');
            expect(row).not.toHaveTextContent('GA101 cancelled by airline');
        });

        it('says the seat is held and the refund is whole', () => {
            renderBookings([disruptedRoundTrip]);

            const row = screen.getByTestId('booking-row-202');
            expect(row).toHaveTextContent(/full refund/i);
            expect(row).toHaveTextContent(/no cancellation fee/i);
        });

        it('keeps the seat change available while another leg still flies', () => {
            // The cancelled leg has nothing to choose; the one beside it may
            // still be flown, and the customer may still want a different seat.
            renderBookings([disruptedRoundTrip]);

            const row = within(screen.getByTestId('booking-row-202'));
            expect(row.getByRole('button', { name: /change seats/i })).toBeInTheDocument();
            expect(row.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
        });

        it('stops promising a refund once the flight has gone', () => {
            // Cancelling a departed booking is refused, so the row must not
            // offer a refund it cannot produce, nor a button that can only
            // fail.
            render(
                <ProfileClient
                    userName="Jane Doe"
                    userAvatar="avatar.png"
                    currentStatus="Gold"
                    currentPoints={4200}
                    bookings={[disruptedRoundTrip] as never}
                    favorites={[]}
                    reviews={[]}
                    activityData={[]}
                    monthlyHistory={[]}
                    renderedAt={new Date('2026-07-01T00:00:00Z').getTime()}
                />
            );

            const row = screen.getByTestId('booking-row-202');
            expect(row).toHaveTextContent(/did not operate/i);
            expect(row).not.toHaveTextContent(/full refund/i);
            expect(within(row).queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
        });

        it('marks a released seat rather than printing the seat somebody else may now hold', () => {
            renderBookings([
                {
                    ...roundTripBooking,
                    legs: roundTripBooking.legs.map((leg, index) => ({
                        ...leg,
                        seatAssignments: index === 0
                            ? [{ passengerId: 'p-1', seatNumber: '11A', releasedAt: new Date() }]
                            : leg.seatAssignments,
                    })),
                },
            ]);

            const legs = within(screen.getByTestId('booking-row-202')).getAllByTestId(/^booking-leg-/);
            expect(legs[0]).toHaveTextContent('Jane (Released)');
            // The number is kept on the row now, and is exactly what must not
            // be shown: the seat is free and may already belong to somebody
            // else (#76).
            expect(legs[0]).not.toHaveTextContent('11A');
        });
    });
});
