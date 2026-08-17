import React from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

/** jsdom has no ResizeObserver; keep the callbacks so a test can fire them. */
const resizeObserverCallbacks: Array<() => void> = [];
beforeEach(() => { resizeObserverCallbacks.length = 0; });
global.ResizeObserver = class {
    constructor(callback: () => void) { resizeObserverCallbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;
import ProfileClient from '@/components/ui/ProfileClient';
import { cancelBookingAction, deleteReviewAction, toggleFavoriteCityGuideAction, changeBookingSeatsAction, getOccupiedSeatsAction, retryBookingRefundAction, rebookItineraryAction } from '@/app/actions';
import type { ReplacementFlightGroup } from '@/lib/itineraryReplacementSearch';
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
    retryBookingRefundAction: jest.fn(),
    rebookItineraryAction: jest.fn(),
}));

jest.mock('@/components/ui/charts/nextStatusChart', () => () => <div data-testid="status-chart" />);
jest.mock('@/components/ui/charts/pointsHistoryChart', () => () => <div data-testid="history-chart" />);

const mockCancelBooking = cancelBookingAction as jest.Mock;
const mockDeleteReview = deleteReviewAction as jest.Mock;
const mockToggleFavorite = toggleFavoriteCityGuideAction as jest.Mock;
const mockChangeBookingSeats = changeBookingSeatsAction as jest.Mock;
const mockGetOccupiedSeats = getOccupiedSeatsAction as jest.Mock;
const mockRetryBookingRefund = retryBookingRefundAction as jest.Mock;
const mockRebookItinerary = rebookItineraryAction as jest.Mock;

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
        const completion = screen.getByRole('status');
        expect(completion).toHaveTextContent(
            'Booking cancelled. Any refund due will appear in the status column.',
        );
        expect(completion).toHaveAttribute('aria-live', 'polite');
        expect(completion).toHaveFocus();
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

        const profile = (
            bookings: unknown[],
            replacementOptions: Record<number, ReplacementFlightGroup[]> = {},
        ) => (
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
                replacementOptions={replacementOptions}
            />
        );
        const renderBookings = (
            bookings: unknown[],
            replacementOptions: Record<number, ReplacementFlightGroup[]> = {},
        ) => render(profile(bookings, replacementOptions));

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
            expect(legs[0]).toHaveTextContent('Jane (Seat 12A)');
            expect(legs[1]).toHaveTextContent('Jane (Seat 4C)');
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
            expect(legs[0]).toHaveTextContent('Jane (No seat assigned)');
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

        it('says the status once, where stacking will show it', () => {
            // #229 put a second copy beside the flight number because the
            // Status column sat past the right edge at 390px. The narrow layout
            // now stacks the cells instead (#240), so the column is on screen
            // and the duplicate is gone -- said twice is what a locator picks
            // the wrong one of.
            renderBookings([disruptedRoundTrip]);

            const row = screen.getByTestId('booking-row-202');
            expect(within(row).getAllByText(/cancelled by airline/)).toHaveLength(1);
            expect(screen.queryByTestId('compact-booking-status-202')).not.toBeInTheDocument();
            expect(screen.getByTestId('booking-status-202')).toHaveTextContent('cancelled by airline');
        });

        it('shows comparable replacement flights on the disrupted booking', () => {
            renderBookings([disruptedRoundTrip], {
                202: [{
                    fromLegId: 502,
                    originalFlightNumber: 'GA900',
                    originalDepartureDate: new Date('2026-06-22T17:00:00Z'),
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    flights: [{
                        id: 303,
                        flightNumber: 'MA901',
                        airline: 'Mona Airways',
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        departureDate: new Date('2026-06-24T17:00:00Z'),
                        durationMinutes: 290,
                        status: 'ON_TIME',
                        firstClassRows: 2,
                        businessRows: 5,
                        premiumEconomyRows: 4,
                        economyRows: 20,
                        seatPattern: 'ABC_DEF',
                    }],
                }],
            });

            const options = within(screen.getByTestId('booking-row-202'))
                .getByRole('region', {
                    name: 'Replacement flights within 3 days for booking 202',
                });
            expect(options.closest('td')).toHaveAttribute('data-label', 'Replacement flights');
            expect(within(options).getByRole('heading', {
                name: 'Replacement flights within 3 days for booking 202',
            }))
                .toBeInTheDocument();
            expect(within(options).getByRole('listitem')).toHaveTextContent('Mona Airways MA901');
            expect(within(options).getByRole('listitem')).toHaveTextContent('Detroit, USA → Seattle, USA');
            expect(within(options).getByRole('listitem')).toHaveTextContent('Jun 24, 2026');
            expect(options).toHaveTextContent('Your original fare is protected.');
            expect(options).toHaveTextContent('Choose replacement flights and seats below');
            expect(within(options).getByRole('button', { name: 'Select replacement seats' }))
                .toBeInTheDocument();
        });

        it('keeps rebooking confirmation announced after refreshed booking props arrive', async () => {
            mockGetOccupiedSeats.mockResolvedValue([]);
            mockRebookItinerary.mockResolvedValue({ bookingId: 202, status: 'CONFIRMED' });
            const options: Record<number, ReplacementFlightGroup[]> = {
                202: [{
                    fromLegId: 502,
                    originalFlightNumber: 'GA900',
                    originalDepartureDate: new Date('2026-06-22T17:00:00Z'),
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    flights: [{
                        id: 303,
                        flightNumber: 'MA901',
                        airline: 'Mona Airways',
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        departureDate: new Date('2026-06-24T17:00:00Z'),
                        durationMinutes: 290,
                        status: 'ON_TIME',
                        firstClassRows: 0,
                        businessRows: 0,
                        premiumEconomyRows: 0,
                        economyRows: 3,
                        seatPattern: 'AB-CD',
                    }],
                }],
            };
            const view = renderBookings([disruptedRoundTrip], options);

            fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
            const dialog = screen.getByRole('dialog');
            fireEvent.change(within(dialog).getByLabelText('Replacement flight for GA900'), {
                target: { value: '303' },
            });
            fireEvent.change(await within(dialog).findByLabelText(
                'Replacement seat for Jane Doe on MA901',
            ), { target: { value: '1A' } });
            fireEvent.click(within(dialog).getByRole('button', {
                name: 'Confirm replacement flights',
            }));

            const completion = await screen.findByRole('status');
            await waitFor(() => expect(completion).toHaveFocus());
            view.rerender(profile([roundTripBooking]));
            expect(screen.getByRole('status')).toHaveTextContent(
                'Booking 202 is confirmed on your replacement flights.',
            );
            expect(screen.getByRole('status')).toHaveFocus();
        });

        it('gives a truthful fallback when the comparable window has no flight', () => {
            renderBookings([disruptedRoundTrip], {
                202: [{
                    fromLegId: 502,
                    originalFlightNumber: 'GA900',
                    originalDepartureDate: new Date('2026-06-22T17:00:00Z'),
                    from: 'Detroit, USA',
                    to: 'Seattle, USA',
                    flights: [],
                }],
            });

            const options = within(screen.getByTestId('booking-row-202'))
                .getByRole('region', {
                    name: 'Replacement flights within 3 days for booking 202',
                });
            expect(options).toHaveTextContent(
                'No complete replacement itinerary is available within three days. Contact support, or cancel for a full refund.',
            );
            expect(within(options).queryByRole('list')).not.toBeInTheDocument();
        });

        it('does not promise a complete itinerary when only one disrupted leg has options', () => {
            renderBookings([disruptedRoundTrip], {
                202: [
                    {
                        fromLegId: 501,
                        originalFlightNumber: 'GA101',
                        originalDepartureDate: new Date('2026-06-15T20:00:00Z'),
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        flights: [{
                            id: 304,
                            flightNumber: 'MA102',
                            airline: 'Mona Airways',
                            from: 'Seattle, USA',
                            to: 'Detroit, USA',
                            departureDate: new Date('2026-06-16T20:00:00Z'),
                            durationMinutes: 250,
                            status: 'ON_TIME',
                            firstClassRows: 2,
                            businessRows: 5,
                            premiumEconomyRows: 4,
                            economyRows: 20,
                            seatPattern: 'ABC_DEF',
                        }],
                    },
                    {
                        fromLegId: 502,
                        originalFlightNumber: 'GA900',
                        originalDepartureDate: new Date('2026-06-22T17:00:00Z'),
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        flights: [],
                    },
                ],
            });

            const options = within(screen.getByTestId('booking-row-202'))
                .getByRole('region', {
                    name: 'Replacement flights within 3 days for booking 202',
                });
            expect(options).toHaveTextContent('No complete replacement itinerary is available');
            expect(options).not.toHaveTextContent('Your original fare is protected.');
            expect(within(options).queryByRole('button', { name: 'Select replacement seats' }))
                .not.toBeInTheDocument();
        });

        it('says a plain confirmed status once too', () => {
            // Only the disrupted case was asserted, so the branch deciding the
            // other two could be reverted in silence.
            renderBookings([roundTripBooking]);

            const row = screen.getByTestId('booking-row-202');
            expect(within(row).getAllByText('Confirmed')).toHaveLength(1);
        });

        it('labels every value it stacks, since the header row goes off-screen', () => {
            // Stacking drops the visual header, so each cell carries what the
            // column used to say. Without this a booking on a phone is a column
            // of unlabelled strings -- and `td:empty` hides the cells a rowSpan
            // leaves behind rather than showing a label with nothing under it.
            renderBookings([roundTripBooking]);

            const row = screen.getByTestId('booking-row-202');
            const withContent = within(row).getAllByRole('cell')
                .filter(cell => cell.textContent?.trim());

            expect(withContent.map(cell => cell.getAttribute('data-label'))).toEqual(
                expect.arrayContaining(['Flight', 'Route', 'Departure', 'Price', 'Status']),
            );

            // The actions cell is the one deliberate exception: its content is
            // two buttons that say what they do, and a heading reading
            // "Actions" above them is noise rather than a label.
            const unlabelled = withContent.filter(cell => !cell.getAttribute('data-label'));
            expect(unlabelled.map(cell => cell.className)).toEqual(
                expect.arrayContaining([expect.stringContaining('booking-actions-cell')]),
            );
            expect(unlabelled).toHaveLength(1);
        });

        it('hides the stacked captions from the accessible name of their cell', () => {
            // The first version drew these with `content: attr(data-label)`,
            // and generated content is folded into the cell's accessible name.
            // A screen reader then read the real column header and heard it
            // again from the cell -- "Status ... STATUS MA404 cancelled by
            // airline" -- which is the say-it-twice defect of #229 rebuilt in
            // CSS, where counting rendered text cannot find it.
            renderBookings([disruptedRoundTrip]);

            const status = screen.getByTestId('booking-status-202');
            const caption = within(status).getByText('Status');

            expect(caption).toHaveAttribute('aria-hidden', 'true');
            expect(caption.tagName).toBe('SPAN');
        });

        it('keeps the action in the same row as the status it answers', () => {
            // The whole of #240: the customer could read that the airline had
            // cancelled their flight and not reach the button that takes the
            // refund, 173px past the right edge. Geometry is Playwright's to
            // prove; this holds the structure that makes it possible.
            renderBookings([disruptedRoundTrip]);

            const row = screen.getByTestId('booking-row-202');
            expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
            expect(within(row).getByText(/Your seat is held/)).toBeInTheDocument();
        });

        it('takes a tab stop when the region genuinely scrolls', () => {
            // The only test that gives the region a measurable, scrolling size.
            // Without it `scrollWidth > clientWidth` is unconstrained: the two
            // other cases feed clientWidth 0 and a non-scrolling 900, so the
            // whole comparison could be replaced by `clientWidth === 0` and
            // both would stay green. That comparison is the entire remaining
            // protection for a table too wide for a small laptop.
            renderBookings([roundTripBooking]);

            const region = screen.getByRole('region', { name: /your bookings/i });
            Object.defineProperty(region, 'clientWidth', { configurable: true, value: 320 });
            Object.defineProperty(region, 'scrollWidth', { configurable: true, value: 700 });
            act(() => { resizeObserverCallbacks.forEach(run => run()); });

            expect(region).toHaveAttribute('tabindex', '0');
        });

        it('stops being a tab stop only when nothing scrolls', () => {
            renderBookings([roundTripBooking]);

            const region = screen.getByRole('region', { name: /your bookings/i });
            const status = screen.getByTestId('booking-status-202');
            Object.defineProperty(region, 'clientWidth', { configurable: true, value: 900 });
            Object.defineProperty(region, 'scrollWidth', { configurable: true, value: 900 });
            Object.defineProperty(region, 'scrollLeft', { configurable: true, value: 0 });
            Object.defineProperty(status, 'offsetLeft', { configurable: true, value: 500 });
            Object.defineProperty(status, 'offsetWidth', { configurable: true, value: 90 });
            act(() => { resizeObserverCallbacks.forEach(run => run()); });

            expect(region).not.toHaveAttribute('tabindex');
        });

        it('names a cancelled booking cancelled', () => {
            // The third branch of the shared `statusText`, which no unit test
            // reached -- only the slow suite caught a break in it.
            renderBookings([{ ...roundTripBooking, status: 'CANCELLED' }]);

            const row = screen.getByTestId('booking-row-202');
            expect(within(row).getAllByText('Cancelled')).toHaveLength(1);
        });

        it('shows the exact completed refund on a cancelled paid booking', () => {
            renderBookings([{
                ...roundTripBooking,
                status: 'CANCELLED',
                statusChanges: [{
                    refundCents: 24_000,
                    paymentRefund: { status: 'SUCCEEDED', amountCents: 24_000 },
                }],
            }]);

            expect(screen.getByTestId('booking-refund-202'))
                .toHaveTextContent('$240 refund sent');
            expect(screen.queryByRole('button', { name: /retry refund/i }))
                .not.toBeInTheDocument();
        });

        it('renders a customer-safe receipt for a captured booking and its refund', () => {
            renderBookings([{
                ...roundTripBooking,
                status: 'CANCELLED',
                paymentReceipt: {
                    // Deliberately differs from the booking total so the card
                    // cannot silently re-price a receipt from the itinerary.
                    amountCents: 65_500,
                    currency: 'USD',
                    paidAt: '2026-06-03T14:30:00Z',
                },
                statusChanges: [{
                    refundCents: 24_000,
                    paymentRefund: { status: 'SUCCEEDED', amountCents: 24_000 },
                }],
            }]);

            const receipt = screen.getByRole('article', { name: 'Receipt for booking 202' });
            expect(receipt).toHaveTextContent('Booking 202');
            expect(receipt).toHaveTextContent('Paid $655 USD');
            expect(receipt).toHaveTextContent('June 3, 2026');
            expect(receipt).toHaveTextContent('GA101, GA900');
            expect(receipt).toHaveTextContent('$240 USD refunded');
            expect(receipt).not.toHaveTextContent(/pi_|checkout|fingerprint/i);
        });

        it('does not turn an unlinked booking fare into a payment receipt', () => {
            renderBookings([roundTripBooking]);

            expect(screen.getByRole('heading', { name: 'Payment history' })).toBeInTheDocument();
            expect(screen.getByText('No payment receipts yet.')).toBeInTheDocument();
            expect(screen.queryByRole('article', { name: /receipt for booking/i }))
                .not.toBeInTheDocument();
        });

        it.each([
            ['PENDING', '$240 USD refund pending'],
            ['FAILED', '$240 USD refund needs attention'],
        ] as const)('renders a customer-safe %s refund outcome in the receipt', (status, copy) => {
            renderBookings([{
                ...roundTripBooking,
                paymentReceipt: {
                    amountCents: 66_000,
                    currency: 'USD',
                    paidAt: '2026-06-01T10:00:00Z',
                },
                statusChanges: [{
                    refundCents: 24_000,
                    paymentRefund: { status, amountCents: 24_000 },
                }],
            }]);

            expect(screen.getByRole('article', { name: 'Receipt for booking 202' }))
                .toHaveTextContent(copy);
        });

        it('announces progress and completion when retrying a failed durable refund', async () => {
            let resolveRetry!: (value: { status: 'SUCCEEDED'; wasSubmitted: true }) => void;
            mockRetryBookingRefund.mockImplementation(() => new Promise(resolve => {
                resolveRetry = resolve;
            }));
            renderBookings([{
                ...roundTripBooking,
                status: 'CANCELLED',
                statusChanges: [{
                    refundCents: 24_000,
                    paymentRefund: { status: 'FAILED', amountCents: 24_000 },
                }],
            }]);

            expect(screen.getByTestId('booking-refund-202'))
                .toHaveTextContent('$240 refund needs attention');
            fireEvent.click(screen.getByRole('button', { name: /retry refund/i }));

            const busyButton = await screen.findByRole('button', { name: 'Retrying refund…' });
            expect(busyButton).toBeDisabled();
            expect(busyButton).toHaveAttribute('aria-busy', 'true');
            expect(screen.getByRole('status')).toHaveTextContent('Retrying your $240 refund.');

            await act(async () => {
                resolveRetry({ status: 'SUCCEEDED', wasSubmitted: true });
            });
            await waitFor(() => {
                expect(mockRetryBookingRefund).toHaveBeenCalledWith(202);
                expect(mockRefresh).toHaveBeenCalled();
            });
            const completion = screen.getByRole('status');
            expect(completion).toHaveTextContent('$240 refund sent.');
            expect(completion).toHaveAttribute('aria-live', 'polite');
            expect(completion).toHaveFocus();
        });

        it('keeps the raised contrast on the status and the seat line', () => {
            // Three contrast improvements in this change were unguarded: the
            // status greens and reds, and the passenger line at 0.4 alpha
            // measuring 3.80:1 (#229). A revert is a one-character edit.
            renderBookings([roundTripBooking]);

            const row = screen.getByTestId('booking-row-202');
            expect(within(screen.getByTestId('booking-status-202')).getByText('Confirmed'))
                .toHaveStyle({ color: '#34d399' });

            // One seat line per leg; they share the style. 0.4 alpha measured
            // 3.80:1 against the card, which is an actual AA failure rather
            // than a near miss.
            const [seatLine] = within(row).getAllByText(/Jane \(Seat/);
            expect(seatLine).toHaveStyle({ color: 'rgba(255,255,255,0.72)' });
        });

        it('keeps the raised contrast on a cancelled status', () => {
            // 6.59:1 against the card, where the shade it replaced measured
            // 4.84:1. Both clear AA, so this guards an improvement rather than
            // a violation -- asserted for symmetry with the other two.
            renderBookings([{ ...roundTripBooking, status: 'CANCELLED' }]);

            expect(within(screen.getByTestId('booking-status-202')).getByText('Cancelled'))
                .toHaveStyle({ color: '#f87171' });
        });

        it('lets a keyboard reach the sideways-scrolling bookings region', () => {
            // The status lives past the right edge at phone width, and a
            // scrollable region a keyboard cannot focus is content it cannot
            // read at all -- WCAG 2.1.1 (#229).
            renderBookings([disruptedRoundTrip]);

            const region = screen.getByRole('region', { name: /your bookings/i });
            expect(region).toHaveAttribute('tabindex', '0');
        });

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
            expect(legs[0]).toHaveTextContent('Jane (Seat released)');
            // The number is kept on the row now, and is exactly what must not
            // be shown: the seat is free and may already belong to somebody
            // else (#76).
            expect(legs[0]).not.toHaveTextContent('11A');
        });
    });
});
