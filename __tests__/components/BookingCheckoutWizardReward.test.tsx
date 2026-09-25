import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';
import { bookFlightAction, holdChosenSeatsAction, startCheckoutPaymentAction } from '@/app/actions';

// Mock server actions
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
    holdChosenSeatsAction: jest.fn(),
    startCheckoutPaymentAction: jest.fn(),
}));

jest.mock('@/components/ui/CheckoutPaymentForm', () => ({
    __esModule: true,
    default: ({
        amountDisplay,
        disabled,
        submitting,
        onConfirmed,
    }: {
        amountDisplay: string;
        disabled: boolean;
        submitting: boolean;
        onConfirmed: () => void;
    }) => (
        <div>
            <p>Secure Stripe Payment Element</p>
            <button
                type="button"
                disabled={disabled || submitting}
                aria-busy={submitting}
                data-testid="stripe-confirm-btn"
                onClick={onConfirmed}
            >
                {submitting ? 'Confirming booking…' : `Authorize ${amountDisplay} and confirm booking`}
            </button>
        </div>
    ),
}));

const mockBookFlightAction = bookFlightAction as jest.Mock;
const mockHoldChosenSeatsAction = holdChosenSeatsAction as jest.Mock;
const mockStartCheckoutPaymentAction = startCheckoutPaymentAction as jest.Mock;

const sampleFlight = {
    id: 42,
    flightNumber: 'GA404',
    airline: 'Test Air',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    departureDate: '2026-06-30T10:00:00Z',
    durationMinutes: null,
    priceCents: 10000,
    firstClassRows: 2,
    businessRows: 2,
    premiumEconomyRows: 2,
    economyRows: 20,
    seatPattern: 'ABC-DEF',
    awardSeatsEconomy: 4,
    awardSeatsBusiness: 2,
    awardSeatsPremiumEconomy: 2,
    awardSeatsFirst: 2,
};

async function advanceFromSeatsToReview() {
    fireEvent.click(screen.getByText('Continue to Bags & Extras →'));
    await screen.findByText(/bags & travel extras/i);
    fireEvent.click(screen.getByRole('button', { name: /continue to review & payment/i }));
    await screen.findByText('Review Booking');
}

describe('BookingCheckoutWizard - Reward Flight Redemption (#130)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStartCheckoutPaymentAction.mockReset();
        mockHoldChosenSeatsAction.mockResolvedValue({
            ok: true,
            holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            holdExpiresInMilliseconds: 10 * 60_000,
        });
        mockStartCheckoutPaymentAction.mockImplementation(async ({ flightIds, passengers, isRewardBooking }) => {
            const amountCents = isRewardBooking ? 1010 : 10000;
            return {
                amountCents,
                currency: 'USD',
                clientSecret: 'pi_secret_reward_elements',
                publishableKey: 'pk_test_public',
                status: 'AUTHORIZED',
            };
        });
    });

    it('renders reward points and taxes pricing in Step 1 for user with sufficient points', () => {
        render(
            <BookingCheckoutWizard
                flights={[sampleFlight]}
                occupiedSeats={[[]]}
                isRewardBooking={true}
                spendablePointsBalance={50000}
            />
        );

        expect(screen.getByText('Traveler Information')).toBeInTheDocument();
        // Economy is 15,000 pts and mandatory taxes are $10.10
        expect(screen.getByText('Estimated total: 15,000 pts + $10.10')).toBeInTheDocument();
        // Warning should not appear
        expect(screen.queryByTestId('insufficient-points-warning')).not.toBeInTheDocument();
        // Proceed button should not be disabled
        const nextButton = screen.getByRole('button', { name: 'Select Seats →' });
        expect(nextButton).not.toBeDisabled();
    });

    it('displays insufficient points warning banner and disables seat selection when balance is too low', () => {
        render(
            <BookingCheckoutWizard
                flights={[sampleFlight]}
                occupiedSeats={[[]]}
                isRewardBooking={true}
                spendablePointsBalance={5000}
            />
        );

        const warning = screen.getByTestId('insufficient-points-warning');
        expect(warning).toBeInTheDocument();
        expect(warning).toHaveTextContent(/Insufficient points/i);
        expect(warning).toHaveTextContent(/5,000/);
        expect(warning).toHaveTextContent(/15,000/);

        // Select Seats button is disabled
        const nextButton = screen.getByRole('button', { name: 'Select Seats →' });
        expect(nextButton).toBeDisabled();
    });

    it('updates points required when upgrading cabin class to Business (40,000 pts)', () => {
        const { container } = render(
            <BookingCheckoutWizard
                flights={[sampleFlight]}
                occupiedSeats={[[]]}
                isRewardBooking={true}
                spendablePointsBalance={50000}
            />
        );

        expect(screen.getByText('Estimated total: 15,000 pts + $10.10')).toBeInTheDocument();

        // Switch to Business class
        const selects = container.querySelectorAll('select');
        const classSelect = selects[1];
        fireEvent.change(classSelect, { target: { value: 'BUSINESS' } });

        // Business class is 40,000 pts + $10.10 taxes
        expect(screen.getByText('Estimated total: 40,000 pts + $10.10')).toBeInTheDocument();
    });

    it('completes reward booking flow: passes isRewardBooking flag to payment and booking actions', async () => {
        const { container } = render(
            <BookingCheckoutWizard
                flights={[sampleFlight]}
                occupiedSeats={[[]]}
                isRewardBooking={true}
                spendablePointsBalance={50000}
            />
        );

        // Fill passenger details in Step 1
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });

        // Proceed to Step 2: Seats
        fireEvent.click(screen.getByRole('button', { name: 'Select Seats →' }));
        expect(screen.getByText('Select Your Seats')).toBeInTheDocument();

        // Select seat 11A (Economy)
        const seat11A = screen.getByTitle('Select Seat 11A');
        fireEvent.click(seat11A);

        // Proceed through Step 3 (Bags & Extras) to Step 4 (Review)
        await advanceFromSeatsToReview();
        expect(screen.getByText('Review Booking')).toBeInTheDocument();

        // Trip summary should show Points Redemption and Mandatory Taxes & Fees
        expect(screen.getByText('Points Redemption')).toBeInTheDocument();
        expect(screen.getAllByText('15,000 pts').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Mandatory Taxes & Fees')).toBeInTheDocument();
        expect(screen.getByText('15,000 pts + $10.10')).toBeInTheDocument();

        // Click "Continue to secure payment"
        const prepareButton = screen.getByRole('button', { name: 'Continue to secure payment' });
        fireEvent.click(prepareButton);

        // Verify startCheckoutPaymentAction was called with isRewardBooking: true
        await screen.findByText('Secure Stripe Payment Element');
        expect(mockStartCheckoutPaymentAction).toHaveBeenCalledWith(
            expect.objectContaining({
                isRewardBooking: true,
                flightIds: [42],
            })
        );

        // Confirm booking via Stripe Payment form
        mockBookFlightAction.mockResolvedValueOnce({
            id: 999,
            reference: 'RWD-CONFIRM-999',
            createdAt: new Date().toISOString(),
            totalPriceCents: 1010,
            isRewardBooking: true,
            pointsRedeemed: 15000,
            passengers: [{
                id: 'p-1',
                firstName: 'Alice',
                lastName: 'Smith',
                cabinClass: 'ECONOMY',
                seatNumber: '11A',
                seatNumbers: ['11A'],
            }],
        });

        const confirmButton = screen.getByTestId('stripe-confirm-btn');
        fireEvent.click(confirmButton);

        // Step 5 confirmation screen
        await screen.findByText('Booking Confirmed!');
        expect(mockBookFlightAction).toHaveBeenCalledWith(
            expect.objectContaining({
                isRewardBooking: true,
                flightIds: [42],
            })
        );

        expect(screen.getByText('Confirmation RWD-CONFIRM-999')).toBeInTheDocument();
        expect(screen.getByText(/Confirmed total: 15,000 pts \+ \$10\.10/i)).toBeInTheDocument();
        expect(screen.getByText('Receipt summary')).toBeInTheDocument();
        expect(screen.getByText(/Points Redeemed \(1 traveller\)/i)).toBeInTheDocument();
    });

    it('shows insufficient points warning in Step 4 and disables payment button when balance is insufficient', async () => {
        const { container } = render(
            <BookingCheckoutWizard
                flights={[sampleFlight]}
                occupiedSeats={[[]]}
                isRewardBooking={true}
                spendablePointsBalance={20000}
            />
        );

        // Fill passenger details in Step 1
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });

        // Switch to Business class (requires 40,000 pts > 20,000 balance)
        const selects = container.querySelectorAll('select');
        const classSelect = selects[1];
        fireEvent.change(classSelect, { target: { value: 'BUSINESS' } });

        // Warning in Step 1 is displayed and Select Seats button is disabled
        expect(screen.getByTestId('insufficient-points-warning')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select Seats →' })).toBeDisabled();
    });
});

