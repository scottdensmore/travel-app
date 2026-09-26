import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightBookingForm from '@/components/ui/flightBookingForm';
import { searchFlightsAction, searchMultiCityFlightsAction } from '@/app/actions';
import type { FlightSearchCriteria } from '@/lib/flightSearchUrl';

jest.mock('@/app/actions', () => ({
    searchFlightsAction: jest.fn(),
    searchMultiCityFlightsAction: jest.fn(),
}));

const mockSearchFlights = searchFlightsAction as jest.Mock;
const mockSearchMultiCity = searchMultiCityFlightsAction as jest.Mock;

const routes = [
    { from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' },
    { from: 'Detroit, USA', to: 'Seattle, USA', nextOperatingDate: '2026-07-18' },
    { from: 'Seattle, USA', to: 'Tokyo, Japan', nextOperatingDate: '2026-07-16' },
];

const mockFlight = {
    id: 101,
    flightNumber: 'GA101',
    airline: 'Gemini Airways',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    departureDate: '2026-07-15T10:00:00Z',
    returnDate: null,
    priceCents: 35000,
    status: 'ON_TIME',
    cabinAvailable: true,
};

describe('FlightBookingForm reward search toggle and badging', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
        jest.clearAllMocks();
        mockSearchFlights.mockResolvedValue({
            flights: [mockFlight],
            nearbyDates: [],
            inbound: null,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Reward search toggle checkbox', () => {
        it('renders the Search reward flights checkbox and updates search criteria', () => {
            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                />
            );
            const rewardCheckbox = screen.getByLabelText(/search reward flights/i);
            expect(rewardCheckbox).not.toBeChecked();

            fireEvent.click(rewardCheckbox);
            expect(rewardCheckbox).toBeChecked();

            fireEvent.click(rewardCheckbox);
            expect(rewardCheckbox).not.toBeChecked();
        });

        it('initializes checkbox state from initialSearch.isRewardSearch', () => {
            const initialSearch: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-15',
                returnDate: '',
                tripType: 'one-way',
                cabinClass: 'ECONOMY',
                isRewardSearch: true,
            };

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={initialSearch}
                />
            );

            const rewardCheckbox = screen.getByLabelText(/search reward flights/i);
            expect(rewardCheckbox).toBeChecked();
        });

        it('passes isRewardSearch: true to searchFlightsAction when checkbox is checked', async () => {
            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                />
            );

            // Select One Way
            fireEvent.click(screen.getByLabelText(/one way/i));

            const rewardCheckbox = screen.getByLabelText(/search reward flights/i);
            fireEvent.click(rewardCheckbox);
            expect(rewardCheckbox).toBeChecked();

            const submitBtn = screen.getByRole('button', { name: /find your trip/i });
            fireEvent.click(submitBtn);

            await waitFor(() => {
                expect(mockSearchFlights).toHaveBeenCalledWith(
                    'Seattle, USA',
                    'Detroit, USA',
                    '2026-07-15',
                    undefined, // one-way returnDate
                    'ECONOMY',
                    true // isRewardSearch
                );
            });
        });

        it('does not pass isRewardSearch to searchFlightsAction when checkbox is unchecked', async () => {
            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                />
            );

            const submitBtn = screen.getByRole('button', { name: /find your trip/i });
            fireEvent.click(submitBtn);

            await waitFor(() => {
                expect(mockSearchFlights).toHaveBeenCalledWith(
                    'Seattle, USA',
                    'Detroit, USA',
                    '2026-07-15',
                    '2026-07-22',
                    'ECONOMY'
                );
            });
        });
    });

    describe('Points pricing pill and award badges in flight results', () => {
        it('renders points pricing pill when reward search is active', async () => {
            const rewardFlight = {
                ...mockFlight,
                awardQuote: {
                    cabinClass: 'ECONOMY',
                    legCount: 1,
                    passengerCount: 1,
                    pointsPerPassengerLeg: 15000,
                    totalPointsRequired: 15000,
                    taxesPerPassengerLegCents: 1010,
                    totalTaxesCents: 1010,
                    formattedPoints: '15,000 pts',
                    formattedTaxes: '$10.10',
                },
                awardAvailable: true,
                remainingAwardSeats: 4,
            };

            mockSearchFlights.mockResolvedValueOnce({
                flights: [rewardFlight],
                nearbyDates: [],
                inbound: null,
            });

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={{
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        departureDate: '2026-07-15',
                        returnDate: '',
                        tripType: 'one-way',
                        cabinClass: 'ECONOMY',
                        isRewardSearch: true,
                    }}
                />
            );

            await waitFor(() => {
                expect(screen.getByText('15,000 pts + $10.10 taxes')).toBeInTheDocument();
            });
        });

        it('falls back to calculateAwardFareQuote if awardQuote is not attached', async () => {
            const rewardFlight = {
                ...mockFlight,
                awardAvailable: true,
                remainingAwardSeats: 4,
            };

            mockSearchFlights.mockResolvedValueOnce({
                flights: [rewardFlight],
                nearbyDates: [],
                inbound: null,
            });

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={{
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        departureDate: '2026-07-15',
                        returnDate: '',
                        tripType: 'one-way',
                        cabinClass: 'ECONOMY',
                        isRewardSearch: true,
                    }}
                />
            );

            await waitFor(() => {
                expect(screen.getByText('15,000 pts + $10.10 taxes')).toBeInTheDocument();
            });
        });

        it('displays amber low inventory warning badge when remainingAwardSeats <= 2 and > 0', async () => {
            const rewardFlight = {
                ...mockFlight,
                awardAvailable: true,
                remainingAwardSeats: 2,
            };

            mockSearchFlights.mockResolvedValueOnce({
                flights: [rewardFlight],
                nearbyDates: [],
                inbound: null,
            });

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={{
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        departureDate: '2026-07-15',
                        returnDate: '',
                        tripType: 'one-way',
                        cabinClass: 'ECONOMY',
                        isRewardSearch: true,
                    }}
                />
            );

            await waitFor(() => {
                expect(screen.getByText('Only 2 award seats left!')).toBeInTheDocument();
            });

            // Booking button should still be available and not disabled
            const bookLink = screen.getByRole('link', { name: /book now/i });
            expect(bookLink).toBeInTheDocument();
            expect(bookLink).toHaveAttribute('href', expect.stringContaining('reward=true'));
        });

        it('displays grey Sold out on points badge and disabled selection button when remainingAwardSeats is 0', async () => {
            const rewardFlight = {
                ...mockFlight,
                awardAvailable: false,
                remainingAwardSeats: 0,
            };

            mockSearchFlights.mockResolvedValueOnce({
                flights: [rewardFlight],
                nearbyDates: [],
                inbound: null,
            });

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={{
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        departureDate: '2026-07-15',
                        returnDate: '',
                        tripType: 'one-way',
                        cabinClass: 'ECONOMY',
                        isRewardSearch: true,
                    }}
                />
            );

            await waitFor(() => {
                expect(screen.getByText('Sold out on points')).toBeInTheDocument();
            });

            // Booking action must be disabled
            const bookButton = screen.getByRole('button', { name: /book now/i });
            expect(bookButton).toBeDisabled();
        });

        it('displays grey Sold out on points badge when awardAvailable is false', async () => {
            const rewardFlight = {
                ...mockFlight,
                awardAvailable: false,
                remainingAwardSeats: 3,
            };

            mockSearchFlights.mockResolvedValueOnce({
                flights: [rewardFlight],
                nearbyDates: [],
                inbound: null,
            });

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={{
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        departureDate: '2026-07-15',
                        returnDate: '',
                        tripType: 'one-way',
                        cabinClass: 'ECONOMY',
                        isRewardSearch: true,
                    }}
                />
            );

            await waitFor(() => {
                expect(screen.getByText('Sold out on points')).toBeInTheDocument();
            });

            const bookButton = screen.getByRole('button', { name: /book now/i });
            expect(bookButton).toBeDisabled();
        });
    });

    describe('Multi-city reward flight search', () => {
        it('passes isRewardSearch: true to searchMultiCityFlightsAction', async () => {
            mockSearchMultiCity.mockResolvedValueOnce({
                legs: [
                    {
                        status: 'ok',
                        from: 'Seattle, USA',
                        to: 'Detroit, USA',
                        departureDate: '2026-07-15',
                        flights: [mockFlight],
                        nearbyDates: [],
                    },
                    {
                        status: 'ok',
                        from: 'Detroit, USA',
                        to: 'Seattle, USA',
                        departureDate: '2026-07-15',
                        flights: [{ ...mockFlight, id: 102, flightNumber: 'GA102' }],
                        nearbyDates: [],
                    },
                ],
                isRewardSearch: true,
            });

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                />
            );

            // Switch to multi-city
            const multiCityRadio = screen.getByLabelText(/multi-city/i);
            fireEvent.click(multiCityRadio);

            // Enable reward search
            const rewardCheckbox = screen.getByLabelText(/search reward flights/i);
            fireEvent.click(rewardCheckbox);

            // Submit
            const submitBtn = screen.getByRole('button', { name: /find your trip/i });
            fireEvent.click(submitBtn);

            await waitFor(() => {
                expect(mockSearchMultiCity).toHaveBeenCalledWith(
                    expect.objectContaining({
                        isRewardSearch: true,
                    })
                );
            });
        });
    });

    describe('Round-trip reward search summary total', () => {
        it('renders combined points and taxes total when both outbound and return flights are selected', async () => {
            const outboundFlight = {
                ...mockFlight,
                id: 101,
                flightNumber: 'GA101',
                priceCents: 35000,
                awardQuote: {
                    cabinClass: 'ECONOMY',
                    legCount: 1,
                    passengerCount: 1,
                    pointsPerPassengerLeg: 15000,
                    totalPointsRequired: 15000,
                    taxesPerPassengerLegCents: 1010,
                    totalTaxesCents: 1010,
                    formattedPoints: '15,000 pts',
                    formattedTaxes: '$10.10',
                },
                remainingAwardSeats: 4,
                awardAvailable: true,
            };
            const inboundFlight = {
                ...mockFlight,
                id: 102,
                flightNumber: 'GA102',
                from: 'Detroit, USA',
                to: 'Seattle, USA',
                departureDate: '2026-07-18T10:00:00Z',
                priceCents: 35000,
                awardQuote: {
                    cabinClass: 'ECONOMY',
                    legCount: 1,
                    passengerCount: 1,
                    pointsPerPassengerLeg: 15000,
                    totalPointsRequired: 15000,
                    taxesPerPassengerLegCents: 1010,
                    totalTaxesCents: 1010,
                    formattedPoints: '15,000 pts',
                    formattedTaxes: '$10.10',
                },
                remainingAwardSeats: 4,
                awardAvailable: true,
            };

            mockSearchFlights.mockResolvedValueOnce({
                flights: [outboundFlight],
                nearbyDates: [],
                inbound: {
                    status: 'ok',
                    flights: [inboundFlight],
                    nearbyDates: [],
                },
                isRewardSearch: true,
            });

            const initialSearch: FlightSearchCriteria = {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: '2026-07-15',
                returnDate: '2026-07-18',
                tripType: 'round-trip',
                cabinClass: 'ECONOMY',
                isRewardSearch: true,
            };

            render(
                <FlightBookingForm
                    routes={routes}
                    minimumDepartureDate="2026-07-14"
                    maximumDepartureDate="2027-07-14"
                    initialSearch={initialSearch}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /Select flight GA101/i })).toBeInTheDocument();
                expect(screen.getByRole('button', { name: /Select flight GA102/i })).toBeInTheDocument();
            });

            // Select outbound leg
            fireEvent.click(screen.getByRole('button', { name: /Select flight GA101/i }));

            // Select return leg
            fireEvent.click(screen.getByRole('button', { name: /Select flight GA102/i }));

            // Verify the round-trip summary displays points and taxes total, not cash fare
            const summary = screen.getByTestId('round-trip-summary');
            expect(summary).toHaveTextContent('GA101 and GA102 · 30,000 pts + $20.20 taxes total');
            expect(summary).not.toHaveTextContent('$700');
        });
    });
});

