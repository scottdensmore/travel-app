import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';
import { bookFlightAction, holdChosenSeatsAction, startCheckoutPaymentAction } from '@/app/actions';

// Mock the server actions
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
                style={{ opacity: submitting ? 0.65 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
                onClick={onConfirmed}
            >
                {submitting ? 'Confirming booking…' : `Authorize ${amountDisplay} and confirm booking`}
            </button>
            {submitting && <p role="status">Confirming booking and checking availability.</p>}
        </div>
    ),
}));

const mockBookFlightAction = bookFlightAction as jest.Mock;
const mockHoldChosenSeatsAction = holdChosenSeatsAction as jest.Mock;
const mockStartCheckoutPaymentAction = startCheckoutPaymentAction as jest.Mock;

const sampleFlight = {
    id: 42,
    flightNumber: 'GA404',
    // Neutral on purpose: the boarding-pass test asserts no "gemini" appears
    // anywhere on the confirmation, and a fixture carrying it would fail that
    // as a brand regression the moment the pass starts showing the operator.
    airline: 'Test Air',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    departureDate: '2026-06-30T10:00:00Z',
    priceCents: 10000
};

async function preparePayment(amount: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
    return screen.findByRole('button', { name: `Authorize ${amount} and confirm booking` });
}

describe('BookingCheckoutWizard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // `clearAllMocks` does not discard queued `mockResolvedValueOnce`
        // responses. A failed test could otherwise hand its payment state to
        // the next checkout and make the failure order-dependent.
        mockStartCheckoutPaymentAction.mockReset();
        // Leaving the seat map holds the chosen seats (#74). Every test that
        // reaches step 3 goes through it, so the default is the ordinary
        // answer; the tests that care about a refusal say so themselves.
        mockHoldChosenSeatsAction.mockResolvedValue({
            ok: true,
            holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            holdExpiresInMilliseconds: 10 * 60_000,
        });
        mockStartCheckoutPaymentAction.mockImplementation(async ({ flightIds }) => ({
            amountCents: flightIds.length === 2 ? 25_000 : 10_000,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            publishableKey: 'pk_test_public',
            status: 'AUTHORIZED',
        }));
    });

    it('renders Step 1 (Travelers) and calculates prices correctly based on cabin class and additions', async () => {
        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);

        // Header and Step 1 indicator
        expect(screen.getByText('Traveler Information')).toBeInTheDocument();
        expect(screen.getByText('Passenger #1')).toBeInTheDocument();

        // Total price should initially be $100 (Economy)
        expect(screen.getByText('Estimated total: $100')).toBeInTheDocument();

        // Fill passenger details
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });

        // Upgrade class to Business (+100%)
        const selects = container.querySelectorAll('select');
        const classSelect = selects[1]; // index 0 is Gender, index 1 is Cabin Class
        fireEvent.change(classSelect, { target: { value: 'BUSINESS' } });

        // Total price should double to $200
        expect(screen.getByText('Estimated total: $200')).toBeInTheDocument();

        // Add a second passenger
        fireEvent.click(screen.getByText('+ Add Traveler'));
        expect(screen.getByText('Passenger #2')).toBeInTheDocument();

        // Total price should be $200 (Passenger 1: Business) + $100 (Passenger 2: Economy) = $300
        expect(screen.getByText('Estimated total: $300')).toBeInTheDocument();

        // Remove Passenger #2
        const removeButtons = screen.getAllByText('✕ Remove');
        fireEvent.click(removeButtons[1]);

        // Verify Passenger #2 is removed and price updates back to $200
        expect(screen.queryByText('Passenger #2')).not.toBeInTheDocument();
        expect(screen.getByText('Estimated total: $200')).toBeInTheDocument();
    });

    it('shows validation errors in Step 1 if fields are missing', async () => {
        render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);

        // Try to proceed without entering details
        fireEvent.click(screen.getByText('Select Seats →'));

        // Expect warning message
        expect(screen.getByText(/Please fill out all details for Passenger 1/i)).toBeInTheDocument();
    });

    it('defaults to an available cabin and hides cabins with zero rows', () => {
        render(<BookingCheckoutWizard flights={[{
            ...sampleFlight,
            economyRows: 0,
            premiumEconomyRows: 2
        }]} occupiedSeats={[[]]} />);

        const cabinSelect = screen.getAllByRole('combobox')[1];
        expect(cabinSelect).toHaveValue('PREMIUM_ECONOMY');
        expect(screen.queryByRole('option', { name: 'Economy' })).not.toBeInTheDocument();
    });

    it('transitions to Step 2 (Seats) and lets passengers select seats, respecting occupied seats', async () => {
        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[['4B']]} />);

        // Step 1 traveler details
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
        
        // Let's keep it economy class
        fireEvent.click(screen.getByText('Select Seats →'));

        // Transitioned to step 2?
        expect(screen.getByText('Select Your Seats')).toBeInTheDocument();

        // Verify we see rows for economy class
        const seat11A = screen.getByTitle('Select Seat 11A');
        expect(seat11A).toBeInTheDocument();
        expect(seat11A).not.toBeDisabled();

        // Select seat 11A
        fireEvent.click(seat11A);

        // Check if selected seat matches in the left panel
        expect(screen.getByText(/Seat:/).textContent).toContain('11A');

        // Let's verify occupied seats are disabled
        // Change traveler class to Business class in step 1, so we see row 4. Let's go back.
        fireEvent.click(screen.getByText('← Back'));
        const selects = container.querySelectorAll('select');
        const classSelect = selects[1];
        fireEvent.change(classSelect, { target: { value: 'BUSINESS' } });
        fireEvent.click(screen.getByText('Select Seats →'));

        // Verify seat 4B (occupied) is disabled
        const seat4B = screen.getByTitle('Seat 4B Occupied');
        expect(seat4B).toBeInTheDocument();
        expect(seat4B).toBeDisabled();

        // Select seat 4A
        const seat4A = screen.getByTitle('Select Seat 4A');
        fireEvent.click(seat4A);
        expect(screen.getByText(/Seat:/).textContent).toContain('4A');

        // Proceed to Step 3
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
        expect(screen.getByText('Review Booking')).toBeInTheDocument();
    });

    it('asks for each chosen seat against the leg it belongs to', async () => {
        // The send half of the round-trip bug. Nothing asserted what was sent,
        // so pairing every seat with `flights[0].id`, or reading
        // `seatNumbers[0]` for every leg, stayed green -- and the receive half
        // would then report the wrong leg no matter how carefully it was fixed.
        const { container } = render(
            <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />,
        );
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));

        await screen.findByText('Review Booking');
        expect(mockHoldChosenSeatsAction).toHaveBeenCalledWith({
            checkoutId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
            claims: [{ flightId: sampleFlight.id, seatNumber: '11A' }],
        });
    });

    it('shows the authoritative hold countdown and recovers as soon as a backgrounded checkout resumes expired', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
        mockHoldChosenSeatsAction.mockImplementation(async () => {
            // A slow round trip must consume visible hold time rather than
            // giving it back when the response arrives.
            jest.setSystemTime(new Date('2026-08-14T12:00:05.000Z'));
            return {
                ok: true,
                holdExpiresAt: '2026-08-14T12:01:05.000Z',
                holdExpiresInMilliseconds: 60_000,
            };
        });

        try {
            const returningFlight = {
                ...sampleFlight,
                id: 43,
                flightNumber: 'GA405',
                from: 'Detroit, USA',
                to: 'Seattle, USA',
            };
            const { container } = render(
                <BookingCheckoutWizard
                    flights={[sampleFlight, returningFlight]}
                    occupiedSeats={[[], []]}
                />,
            );
            fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
            fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
            fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
            fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
            fireEvent.click(screen.getByText('+ Add Traveler'));
            fireEvent.change(screen.getAllByPlaceholderText('John')[1], { target: { value: 'Grace' } });
            fireEvent.change(screen.getAllByPlaceholderText('Doe')[1], { target: { value: 'Hopper' } });
            fireEvent.change(container.querySelectorAll('input[type="date"]')[1], { target: { value: '1906-12-09' } });
            fireEvent.change(screen.getAllByPlaceholderText('A00000000')[1], { target: { value: 'US4440000' } });
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByText(/Auto-Assign Adjacent Seats/i));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByText(/Auto-Assign Adjacent Seats/i));
            fireEvent.click(screen.getByText('Review Booking →'));

            await act(async () => {});
            expect(screen.getByRole('timer')).toHaveTextContent('Seat hold expires in 00:55');

            // Returning to a still-live checkout must reconcile immediately,
            // even when the document visibility state did not change.
            act(() => {
                jest.setSystemTime(new Date('2026-08-14T12:00:15.000Z'));
                window.dispatchEvent(new Event('focus'));
            });
            expect(screen.getByRole('timer')).toHaveTextContent('Seat hold expires in 00:45');

            // Advancing the wall clock does not run an interval. The
            // visibility event is what must reconcile a suspended tab with
            // the absolute deadline rather than resuming a drifted counter.
            act(() => {
                jest.setSystemTime(new Date('2026-08-14T12:01:01.000Z'));
                document.dispatchEvent(new Event('visibilitychange'));
            });

            expect(screen.getByRole('heading', { name: 'Select Your Seats' })).toBeInTheDocument();
            expect(screen.getByRole('alert')).toHaveTextContent(/seat hold expired/i);
            const firstTraveler = screen.getByRole('button', { name: /Alice Smith.*Seat: Not Chosen/i });
            expect(firstTraveler).toHaveFocus();
            expect(firstTraveler).toHaveClass('booking-passenger-target');
            expect(screen.getByRole('button', { name: /Grace Hopper.*Seat: Not Chosen/i }))
                .toBeInTheDocument();
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            expect(screen.getByRole('button', { name: /Alice Smith.*Seat: Not Chosen/i }))
                .toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Grace Hopper.*Seat: Not Chosen/i }))
                .toBeInTheDocument();
            expect(mockBookFlightAction).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('blocks confirmation when the deadline passes before the next timer tick', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
        mockHoldChosenSeatsAction.mockResolvedValue({
            ok: true,
            holdExpiresAt: '2026-08-14T12:01:00.000Z',
            holdExpiresInMilliseconds: 60_000,
        });

        try {
            const { container } = render(
                <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />,
            );
            fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
            fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
            fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
            fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));
            await act(async () => {});

            jest.setSystemTime(new Date('2026-08-14T12:01:01.000Z'));
            fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));

            expect(screen.getByRole('heading', { name: 'Select Your Seats' })).toBeInTheDocument();
            expect(mockBookFlightAction).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('says so when the seats could not be held at all', async () => {
        // An expired session or a dropped connection. Without a catch the
        // promise rejected into nothing: no message, and a button that simply
        // stopped working.
        mockHoldChosenSeatsAction.mockRejectedValue(new Error('Unauthorized'));

        const { container } = render(
            <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />,
        );
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not hold those seats/i);
        expect(screen.getByText('Select Your Seats')).toBeInTheDocument();
    });

    it('brings the refusal into view and puts focus on it', async () => {
        // The banner renders above a thirty-row seat map and the button that
        // raises it is below one, so it appeared 598px above the viewport at
        // 390 and 207px at 1280: announced to a screen reader, invisible to
        // everyone else, who saw a button that did nothing.
        mockHoldChosenSeatsAction.mockResolvedValue({
            ok: false,
            takenSeats: [{ flightId: sampleFlight.id, seatNumber: '11A' }],
        });
        const scrollIntoView = jest.spyOn(Element.prototype, 'scrollIntoView');

        const { container } = render(
            <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />,
        );
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));

        const alert = await screen.findByRole('alert');
        expect(scrollIntoView).toHaveBeenCalled();
        expect(alert).toHaveFocus();
        scrollIntoView.mockRestore();
    });

    it('keeps the customer on the seat map when a seat has just been taken', async () => {
        // The race the hold exists to decide (#74). Another checkout got 4A
        // between this page rendering and this checkout leaving the map, so
        // advancing has to fail here rather than at payment -- the seat map is
        // where the problem can be fixed.
        mockHoldChosenSeatsAction.mockResolvedValue({
            ok: false,
            // The leg travels with the seat: a round trip can carry 11A twice.
            takenSeats: [{ flightId: sampleFlight.id, seatNumber: '11A' }],
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            /Seat 11A is being held in another checkout/i,
        );
        expect(screen.getByText('Select Your Seats')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Review Booking' })).not.toBeInTheDocument();
    });

    it('marks a seat lost to another checkout as taken on the map', async () => {
        // The map was rendered before the seat went, so without this the error
        // names a seat the map still draws as free -- the page arguing with
        // itself, and the customer with no way to see what changed.
        mockHoldChosenSeatsAction.mockResolvedValue({
            ok: false,
            // The leg travels with the seat: a round trip can carry 11A twice.
            takenSeats: [{ flightId: sampleFlight.id, seatNumber: '11A' }],
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));

        await screen.findByRole('alert');
        expect(screen.queryByTitle('Select Seat 11A')).not.toBeInTheDocument();
    });

    it('confirms a server-priced booking through hosted payment fields without collecting card data', async () => {
        mockStartCheckoutPaymentAction
            .mockResolvedValueOnce({
                amountCents: 10_000,
                currency: 'USD',
                clientSecret: 'pi_secret_for_elements',
                publishableKey: 'pk_test_public',
                status: 'REQUIRES_PAYMENT_METHOD',
            })
            .mockResolvedValueOnce({
                amountCents: 10_000,
                currency: 'USD',
                clientSecret: 'pi_secret_for_elements',
                publishableKey: 'pk_test_public',
                status: 'CAPTURED',
            });
        mockBookFlightAction.mockResolvedValue({
            id: 12345,
            totalPriceCents: 10000,
            // The booking reports one seat per leg, in leg order; the cabin
            // comes from the request rather than the traveller row (#137).
            passengers: [{
                firstName: 'Robert',
                lastName: 'Jones',
                seatNumbers: ['11C'],
                cabinClass: 'ECONOMY'
            }]
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);

        // Fill Passenger 1 details
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Bob' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Jones' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1988-12-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US9876543' } });

        // Select Seats
        fireEvent.click(screen.getByText('Select Seats →'));
        
        // Select seat 11C
        const seat11C = screen.getByTitle('Select Seat 11C');
        fireEvent.click(seat11C);
        
        // Proceed to Billing
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

        // Verify summary details are correct. The seat is read off the leg it
        // is held on, and the fare breakdown carries the cabin (#152).
        expect(screen.getByTestId('review-leg')).toHaveTextContent('Bob Jones');
        expect(screen.getByTestId('review-leg')).toHaveTextContent('Seat 11C');
        expect(screen.getByText('Class: Economy')).toBeInTheDocument();
        expect(screen.getByText('Estimated Total')).toBeInTheDocument();

        expect(screen.queryByPlaceholderText('4111 2222 3333 4444')).not.toBeInTheDocument();
        const paymentButton = await preparePayment('$100');
        expect(screen.getByText('Secure Stripe Payment Element')).toBeInTheDocument();
        expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();

        // Submit Booking
        fireEvent.click(paymentButton);

        // Wait for step 4 success page
        await waitFor(() => {
            expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
            expect(screen.getByText('Your booking was created after Stripe approved the payment.'))
                .toBeInTheDocument();
            expect(mockBookFlightAction).toHaveBeenCalledTimes(1);
            expect(mockBookFlightAction).toHaveBeenCalledWith({
                flightIds: [42],
                passengers: [{
                    firstName: 'Bob',
                    lastName: 'Jones',
                    dateOfBirth: new Date('1988-12-01').toISOString(),
                    passportNumber: 'US9876543',
                    gender: 'Male',
                    seatNumbers: ['11C'],
                    cabinClass: 'ECONOMY'
                }],
                idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i)
            });
        });

        const checkoutId = mockHoldChosenSeatsAction.mock.calls[0][0].checkoutId;
        expect(mockStartCheckoutPaymentAction).toHaveBeenCalledWith({
            checkoutId,
            flightIds: [42],
            passengers: [{ seatNumbers: ['11C'], cabinClass: 'ECONOMY' }],
        });

        // Verify Boarding Pass renders details
        expect(screen.getByText('Robert Jones')).toBeInTheDocument();
        expect(screen.getByText('GA404')).toBeInTheDocument();
        expect(screen.getByText('11C')).toBeInTheDocument();
        expect(screen.getByText('Economy')).toBeInTheDocument();
    });

    it('does not create a booking when the server has not observed authorization', async () => {
        mockStartCheckoutPaymentAction
            .mockResolvedValueOnce({
                amountCents: 10_000,
                currency: 'USD',
                clientSecret: 'pi_secret_for_elements',
                publishableKey: 'pk_test_public',
                status: 'REQUIRES_PAYMENT_METHOD',
            })
            .mockResolvedValueOnce({
                amountCents: 10_000,
                currency: 'USD',
                clientSecret: 'pi_secret_for_elements',
                publishableKey: 'pk_test_public',
                status: 'PROCESSING',
            });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Lovelace' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US5550000' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));
        await screen.findByText('Review Booking');

        fireEvent.click(await preparePayment('$100'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Your payment is still processing. No booking has been created yet.',
        );
        expect(mockBookFlightAction).not.toHaveBeenCalled();
    });

    it('does not expose a Stripe server error when authorization cannot be rechecked', async () => {
        mockStartCheckoutPaymentAction
            .mockResolvedValueOnce({
                amountCents: 10_000,
                currency: 'USD',
                clientSecret: 'pi_secret_for_elements',
                publishableKey: 'pk_test_public',
                status: 'REQUIRES_PAYMENT_METHOD',
            })
            .mockRejectedValueOnce(new Error('provider request included a sensitive value'));

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Lovelace' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US5550000' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));
        await screen.findByText('Review Booking');

        fireEvent.click(await preparePayment('$100'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'We could not verify the payment authorization just now. No booking has been created yet.',
        );
        expect(screen.queryByText(/sensitive value/i)).not.toBeInTheDocument();
        expect(mockBookFlightAction).not.toHaveBeenCalled();
    });

    it('shows a recoverable error when secure payment preparation fails', async () => {
        mockStartCheckoutPaymentAction.mockRejectedValueOnce(new Error('Stripe unavailable'));

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Lovelace' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US5550000' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));
        await screen.findByText('Review Booking');

        fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'We could not prepare secure payment just now. Please try again.',
        );
        expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled();
        expect(mockBookFlightAction).not.toHaveBeenCalled();
    });

    it('uses the server-priced amount in the authorization action', async () => {
        mockStartCheckoutPaymentAction.mockResolvedValueOnce({
            amountCents: 12_345,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            publishableKey: 'pk_test_public',
            status: 'REQUIRES_PAYMENT_METHOD',
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Lovelace' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US5550000' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11A'));
        fireEvent.click(screen.getByText('Review Booking →'));
        await screen.findByText('Review Booking');

        fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));

        const paymentHeading = await screen.findByRole('heading', { name: 'Secure payment' });
        await waitFor(() => expect(paymentHeading).toHaveFocus());
        expect(await screen.findByRole('button', {
            name: 'Authorize $123.45 and confirm booking',
        })).toBeEnabled();
        expect(screen.getByText('Stripe will authorize $123.45. This step does not capture funds.'))
            .toBeInTheDocument();
    });

    it('does not expose a server error when booking fails after payment authorization', async () => {
        mockBookFlightAction.mockRejectedValue(new Error('provider request included a sensitive value'));

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);

        // Fill passenger details
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'John' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Doe' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1970-01-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'PP12345' } });

        // Seats Step
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11D'));

        // Review Step
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

        // Submit Booking
        fireEvent.click(await preparePayment('$100'));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('We couldn’t confirm your booking. Please try again.');
        expect(alert).not.toHaveTextContent(/sensitive value/i);
    });

    it('announces and visibly disables the confirmation action while booking', async () => {
        let resolveBooking!: (value: {
            id: number;
            totalPriceCents: number | null;
            passengers: Array<{ firstName: string; lastName: string; seatNumbers: string[]; cabinClass: string }>;
        }) => void;
        mockBookFlightAction.mockImplementation(() => new Promise((resolve) => {
            resolveBooking = resolve;
        }));

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Bob' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Jones' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1988-12-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US9876543' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11C'));
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

        fireEvent.click(await preparePayment('$100'));

        const pendingButton = screen.getByRole('button', { name: /Confirming booking/i });
        expect(pendingButton).toBeDisabled();
        expect(pendingButton).toHaveAttribute('aria-busy', 'true');
        expect(pendingButton).toHaveStyle({ opacity: '0.65', cursor: 'not-allowed' });
        expect(screen.getByRole('status')).toHaveTextContent('Confirming booking and checking availability.');

        await waitFor(() => expect(mockBookFlightAction).toHaveBeenCalledTimes(1));
        await act(async () => {
            resolveBooking({
                id: 12345,
                totalPriceCents: 10000,
                passengers: [{ firstName: 'Bob', lastName: 'Jones', seatNumbers: ['11C'], cabinClass: 'ECONOMY' }]
            });
        });
        const confirmationHeading = await screen.findByRole('heading', { name: 'Booking Confirmed!' });
        await waitFor(() => expect(confirmationHeading).toHaveFocus());
    });

    it('uses booking-specific copy for an unknown submission failure', async () => {
        mockBookFlightAction.mockRejectedValue('network failure');

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Bob' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Jones' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1988-12-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US9876543' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11C'));
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
        fireEvent.click(await preparePayment('$100'));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t confirm your booking. Please try again.');
        });
    });

    it('routes server passenger validation errors back to the associated field', async () => {
        mockBookFlightAction.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'First name is required.',
                fields: { 'passengers.0.firstName': ['First name is required.'] },
            },
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        const firstName = screen.getByPlaceholderText('John');
        fireEvent.change(firstName, { target: { value: 'Bob' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Jones' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1988-12-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US9876543' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11C'));
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
        fireEvent.click(await preparePayment('$100'));

        await waitFor(() => expect(screen.getByText('Traveler Information')).toBeInTheDocument());
        expect(screen.getByRole('alert')).toHaveTextContent('First name is required.');
        const invalidFirstName = screen.getByPlaceholderText('John');
        expect(invalidFirstName).toHaveAttribute('aria-invalid', 'true');
        expect(invalidFirstName).toHaveAccessibleDescription('First name is required.');
        await waitFor(() => expect(invalidFirstName).toHaveFocus());
    });

    it('routes server seat validation errors to an accessible passenger target', async () => {
        mockBookFlightAction.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Seat number is invalid.',
                // Zod names the offending leg, so the path carries an index.
                fields: { 'passengers.0.seatNumbers.0': ['Seat number is invalid.'] },
            },
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Bob' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Jones' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1988-12-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US9876543' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11C'));
        fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
        fireEvent.click(await preparePayment('$100'));

        await waitFor(() => expect(screen.getByText('Select Your Seats')).toBeInTheDocument());
        const passengerTarget = screen.getByRole('button', { name: /Bob Jones.*Seat: Not Chosen/i });
        expect(passengerTarget).toHaveAttribute('data-invalid', 'true');
        expect(passengerTarget).toHaveAccessibleDescription('Seat number is invalid.');
        await waitFor(() => expect(passengerTarget).toHaveFocus());
    });

    it('clears a lost hold and returns focus to the seat map for recovery', async () => {
        mockBookFlightAction.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Seat 11C is no longer held for this checkout. Please choose a seat again.',
                fields: {
                    'passengers.0.seatNumbers.0': [
                        'Seat 11C is no longer held for this checkout. Please choose a seat again.',
                    ],
                },
            },
        });

        const { container } = render(<BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />);
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Bob' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Jones' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1988-12-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US9876543' } });
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11C'));
        fireEvent.click(screen.getByText('Review Booking →'));
        await screen.findByText('Review Booking');
        fireEvent.click(await preparePayment('$100'));

        await screen.findByText('Select Your Seats');
        const passengerTarget = screen.getByRole('button', { name: /Bob Jones.*Seat: Not Chosen/i });
        expect(screen.getByRole('alert')).toHaveTextContent('Please choose a seat again.');
        await waitFor(() => expect(passengerTarget).toHaveFocus());
    });

    describe('Multi-Passenger Coordinated Adjacent Seat Maps', () => {
        const twoPassengersFlight = {
            ...sampleFlight,
            priceCents: 10000
        };

        const setupStep2WithTwoPassengers = (
            occupied: string[] = [],
            flight: React.ComponentProps<typeof BookingCheckoutWizard>['flights'][number] = twoPassengersFlight
        ) => {
            const { container } = render(<BookingCheckoutWizard flights={[flight]} occupiedSeats={[occupied]} />);
            
            // Passenger 1 details
            fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
            fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
            fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1995-05-15' } });
            fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });

            // Add Passenger 2
            fireEvent.click(screen.getByText('+ Add Traveler'));
            const inputs = screen.getAllByPlaceholderText('John');
            const linputs = screen.getAllByPlaceholderText('Doe');
            const dates = container.querySelectorAll('input[type="date"]');
            const passports = screen.getAllByPlaceholderText('A00000000');

            fireEvent.change(inputs[1], { target: { value: 'Bob' } });
            fireEvent.change(linputs[1], { target: { value: 'Jones' } });
            fireEvent.change(dates[1], { target: { value: '1990-10-10' } });
            fireEvent.change(passports[1], { target: { value: 'US7654321' } });

            fireEvent.click(screen.getByText('Select Seats →'));
            return { container };
        };

        it('renders the auto-allocation options and manual auto-assign button when there are multiple travelers', () => {
            setupStep2WithTwoPassengers();

            expect(screen.getByLabelText(/Auto-allocate adjacent seats on map click/i)).toBeInTheDocument();
            expect(screen.getByText(/Auto-Assign Adjacent Seats/i)).toBeInTheDocument();
        });

        it('does not render auto-allocation controls when there is only one traveler', () => {
            render(<BookingCheckoutWizard flights={[twoPassengersFlight]} occupiedSeats={[[]]} />);
            // Fill single passenger details
            fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Alice' } });
            fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Smith' } });
            const dates = document.querySelectorAll('input[type="date"]');
            fireEvent.change(dates[0], { target: { value: '1995-05-15' } });
            fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US1234567' } });
            fireEvent.click(screen.getByText('Select Seats →'));

            expect(screen.queryByLabelText(/Auto-allocate adjacent seats on map click/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/Auto-Assign Adjacent Seats/i)).not.toBeInTheDocument();
        });

        it('auto-assigns contiguous adjacent seats for the group using the manual button', () => {
            setupStep2WithTwoPassengers();

            // Click manual auto-assign button
            fireEvent.click(screen.getByText(/Auto-Assign Adjacent Seats/i));

            // Verify both travelers are assigned adjacent seats (11A and 11B by default)
            const passengerCards = screen.getAllByText(/Class:/);
            expect(passengerCards[0].textContent).toContain('Seat: 11A');
            expect(passengerCards[1].textContent).toContain('Seat: 11B');
        });

        it('auto-assigns only seats present in a custom layout', () => {
            setupStep2WithTwoPassengers([], {
                ...twoPassengersFlight,
                seatPattern: 'AC-DF'
            });

            fireEvent.click(screen.getByText(/Auto-Assign Adjacent Seats/i));

            const passengerCards = screen.getAllByText(/Class:/);
            expect(passengerCards[0].textContent).toContain('Seat: 11A');
            expect(passengerCards[1].textContent).toContain('Seat: 11C');
        });

        it('auto-allocates adjacent seats on map click when checked', () => {
            setupStep2WithTwoPassengers();

            // Select seat 11D
            const seat11D = screen.getByTitle('Select Seat 11D');
            fireEvent.click(seat11D);

            // Active traveler gets 11D, the next traveler gets adjacent 11E
            const passengerCards = screen.getAllByText(/Class:/);
            expect(passengerCards[0].textContent).toContain('Seat: 11D');
            expect(passengerCards[1].textContent).toContain('Seat: 11E');
        });

        it('does not auto-allocate adjacent seats on map click when unchecked', () => {
            setupStep2WithTwoPassengers();

            // Uncheck auto-allocate toggle
            const checkbox = screen.getByLabelText(/Auto-allocate adjacent seats on map click/i);
            fireEvent.click(checkbox);

            // Select seat 11D
            const seat11D = screen.getByTitle('Select Seat 11D');
            fireEvent.click(seat11D);

            // Only active traveler gets seat, next traveler has no seat
            const passengerCards = screen.getAllByText(/Class:/);
            expect(passengerCards[0].textContent).toContain('Seat: 11D');
            expect(passengerCards[1].textContent).toContain('Seat: Not Chosen');
        });

        it('allows swapping seats when clicking on a seat already occupied by a group member', () => {
            setupStep2WithTwoPassengers();

            // Uncheck auto-allocate toggle to manually assign seats
            const checkbox = screen.getByLabelText(/Auto-allocate adjacent seats on map click/i);
            fireEvent.click(checkbox);

            // Select seat 11A for active Passenger 1 manually
            const seat11A = screen.getByTitle('Select Seat 11A');
            fireEvent.click(seat11A);

            // Switch active passenger to Passenger 2
            fireEvent.click(screen.getByRole('button', { name: /Bob Jones.*Seat: Not Chosen/i }));

            // Select seat 11C for Passenger 2
            const seat11C = screen.getByTitle('Select Seat 11C');
            fireEvent.click(seat11C);

            // Verify Alice has 11A and Bob has 11C
            let cards = screen.getAllByText(/Class:/);
            expect(cards[0].textContent).toContain('Seat: 11A');
            expect(cards[1].textContent).toContain('Seat: 11C');

            // Switch back to Passenger 1
            fireEvent.click(screen.getByRole('button', { name: /Alice Smith.*Seat: 11A/i }));

            // Click Bob's seat (11C) to swap
            fireEvent.click(screen.getByTitle(/Seat 11C/));

            // Verify Alice now has 11C and Bob has 11A
            cards = screen.getAllByText(/Class:/);
            expect(cards[0].textContent).toContain('Seat: 11C');
            expect(cards[1].textContent).toContain('Seat: 11A');
        });
    });

    describe('Round-trip itineraries', () => {
        const inboundFlight = {
            ...sampleFlight,
            id: 43,
            flightNumber: 'GA405',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2026-07-07T10:00:00Z',
            priceCents: 15000
        };

        const renderRoundTrip = (occupied: string[][] = [[], []]) =>
            render(<BookingCheckoutWizard flights={[sampleFlight, inboundFlight]} occupiedSeats={occupied} />);

        const fillTraveler = (container: HTMLElement) => {
            fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Ada' } });
            fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Lovelace' } });
            fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
            fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US5550000' } });
        };

        it('prices every leg at its own fare', () => {
            renderRoundTrip();

            // $100 outbound + $150 return, not the outbound fare twice.
            expect(screen.getByText('Estimated total: $250')).toBeInTheDocument();
        });

        it('offers a leg switcher only when the itinerary has more than one leg', () => {
            const { unmount } = renderRoundTrip();
            fillTraveler(document.body);
            fireEvent.click(screen.getByText('Select Seats →'));

            const tabs = screen.getAllByRole('tab');
            expect(tabs).toHaveLength(2);
            expect(tabs[0]).toHaveTextContent('Departing');
            expect(tabs[0]).toHaveTextContent('Seattle, USA → Detroit, USA');
            expect(tabs[1]).toHaveTextContent('Returning');
            expect(tabs[1]).toHaveTextContent('Detroit, USA → Seattle, USA');
            expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

            unmount();

            const { container } = render(
                <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />
            );
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            expect(screen.queryByTestId('leg-switcher')).not.toBeInTheDocument();
        });

        it('moves between legs with the arrow keys and keeps one tab stop', () => {
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            const [departing, returning] = screen.getAllByRole('tab');
            expect(departing).toHaveAttribute('tabindex', '0');
            expect(returning).toHaveAttribute('tabindex', '-1');
            expect(departing).toHaveAttribute('aria-controls', 'leg-panel-0');
            expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'leg-tab-0');

            departing.focus();
            fireEvent.keyDown(departing, { key: 'ArrowRight' });

            expect(returning).toHaveAttribute('aria-selected', 'true');
            expect(returning).toHaveAttribute('tabindex', '0');
            expect(returning).toHaveFocus();
            expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'leg-tab-1');

            // Wraps around at the end.
            fireEvent.keyDown(returning, { key: 'ArrowRight' });
            expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
        });

        it('sends a server-side seat error to the leg it names', async () => {
            mockBookFlightAction.mockResolvedValue({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'That seat was just taken.',
                    fields: { 'passengers.0.seatNumbers.1': ['That seat was just taken.'] }
                }
            });

            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

            // Go back to the departing leg so the error has a leg to correct.
            fireEvent.click(screen.getByText('← Back'));
            fireEvent.click(screen.getByRole('tab', { name: /Departing/ }));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
            fireEvent.click(await preparePayment('$250'));

            // The error names leg 1, so the returning map must be the one shown.
            await waitFor(() =>
                expect(screen.getByRole('tab', { name: /Returning/ })).toHaveAttribute('aria-selected', 'true')
            );
            expect(screen.getByText('Select Your Seats')).toBeInTheDocument();
        });

        it('shows each leg its own occupancy', () => {
            const { container } = renderRoundTrip([['11A'], ['11B']]);
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            // Outbound: 11A is taken, 11B is free.
            expect(screen.getByTitle('Seat 11A Occupied')).toBeInTheDocument();
            expect(screen.getByTitle('Select Seat 11B')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));

            // Return: the reverse. A leg-blind seat map would keep showing 11A taken.
            expect(screen.getByTitle('Seat 11B Occupied')).toBeInTheDocument();
            expect(screen.getByTitle('Select Seat 11A')).toBeInTheDocument();
        });

        it('sends each leg its own flight id, not the first one twice', async () => {
            // A one-leg assertion cannot see this: with a single flight,
            // `flights[0].id` is the right answer by accident. Only a round
            // trip distinguishes "the leg this seat belongs to" from "the first
            // leg", which is the send half of the bug ui-review found.
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(await screen.findByTitle('Select Seat 12B'));
            fireEvent.click(screen.getByText('Review Booking →'));

            await screen.findByText('Review Booking');
            expect(mockHoldChosenSeatsAction).toHaveBeenCalledWith({
                checkoutId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
                claims: [
                    { flightId: sampleFlight.id, seatNumber: '11A' },
                    { flightId: inboundFlight.id, seatNumber: '12B' },
                ],
            });
        });

        it('blames the leg that actually lost the seat, not the one on screen', async () => {
            // A round trip can carry 11A on both legs. Reporting the seat
            // number alone made the client mark whichever leg it found first,
            // so a customer who had just been *granted* their outbound seat was
            // told it was gone -- and shown it disabled, while the leg that
            // really failed sat on a tab they were not looking at (#74).
            mockHoldChosenSeatsAction.mockResolvedValue({
                ok: false,
                takenSeats: [{ flightId: inboundFlight.id, seatNumber: '11A' }],
            });

            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(await screen.findByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));

            expect(await screen.findByRole('alert')).toHaveTextContent(
                /Seat 11A on the returning flight is being held in another checkout/i,
            );

            // The failing leg is the one to look at.
            expect(screen.getByRole('tab', { name: /Returning/ })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByTitle('Seat 11A Occupied')).toBeDisabled();

            // The outbound seat was granted and stays the customer's: not
            // marked occupied, and still theirs in the passenger list. This is
            // the half that was wrong -- it was drawn red and disabled while
            // the error said it had gone.
            fireEvent.click(screen.getByRole('tab', { name: /Departing/ }));
            expect(await screen.findByRole('tab', { name: /Departing/ }))
                .toHaveAttribute('aria-selected', 'true');
            expect(screen.queryByTitle('Seat 11A Occupied')).not.toBeInTheDocument();
        });

        it('lets go of a seat it could not hold, so the button stops re-failing', async () => {
            // Left in place the seat reads as chosen in the passenger list
            // while the map draws it occupied and disabled, `validateStep2`
            // keeps passing, and pressing the button again re-fails against a
            // seat that can never be had.
            mockHoldChosenSeatsAction.mockResolvedValue({
                ok: false,
                takenSeats: [{ flightId: inboundFlight.id, seatNumber: '11A' }],
            });

            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            // The map re-renders for the new leg before 11A is selectable again.
            fireEvent.click(await screen.findByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));

            await screen.findByRole('alert');

            // Advancing again now stops on the missing seat rather than
            // silently asking for the dead one a second time.
            fireEvent.click(screen.getByText('Review Booking →'));
            expect(await screen.findByRole('alert')).toHaveTextContent(/returning seat for Passenger 1/i);
        });

        it('will not advance while a leg is unseated, and points at the leg that needs one', async () => {
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            // Seat the outbound only, then try to move on.
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));

            expect(screen.getByText('Select Your Seats')).toBeInTheDocument();
            expect(screen.getByRole('alert')).toHaveTextContent(/returning seat for Passenger 1/i);
            await waitFor(() =>
                expect(screen.getByRole('tab', { name: /Returning/ })).toHaveAttribute('aria-selected', 'true')
            );

            // Seating the return unblocks the step.
            fireEvent.click(screen.getByTitle('Select Seat 12C'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
            expect(screen.getByRole('heading', { name: 'Review Booking' })).toBeInTheDocument();
        });

        it('reviews every leg of the itinerary, not just the last one opened', async () => {
            // The review step read the leg the seat map happened to be showing,
            // so a round trip offered one flight card — the customer could not
            // check the return leg on the last screen before confirming (#152).
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

            const legs = screen.getAllByTestId('review-leg');
            expect(legs).toHaveLength(2);

            expect(legs[0]).toHaveTextContent('Departing');
            expect(legs[0]).toHaveTextContent('GA404');
            expect(legs[0]).toHaveTextContent('Seattle, USA → Detroit, USA');

            expect(legs[1]).toHaveTextContent('Returning');
            expect(legs[1]).toHaveTextContent('GA405');
            expect(legs[1]).toHaveTextContent('Detroit, USA → Seattle, USA');
        });

        it('shows each seat against the leg it is held on', async () => {
            // Seats were pooled into one comma list with nothing saying which
            // seat belonged to which flight (#152).
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

            const [departing, returning] = screen.getAllByTestId('review-leg');
            expect(departing).toHaveTextContent('Ada Lovelace');
            expect(departing).toHaveTextContent('11A');
            expect(departing).not.toHaveTextContent('12C');

            expect(returning).toHaveTextContent('Ada Lovelace');
            expect(returning).toHaveTextContent('12C');
            expect(returning).not.toHaveTextContent('11A');
        });

        it('still names one leg and one seat on a one-way review', async () => {
            const { container } = render(
                <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />
            );
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

            const legs = screen.getAllByTestId('review-leg');
            expect(legs).toHaveLength(1);
            expect(legs[0]).toHaveTextContent('GA404');
            expect(legs[0]).toHaveTextContent('11A');
            // A single leg is not a direction; the eyebrow belongs to a trip
            // that has more than one.
            expect(legs[0]).not.toHaveTextContent('Departing');
        });

        it('does not bill a lone traveller in a breakdown of one row', async () => {
            // Seats moved into the leg cards, so a single traveller would
            // otherwise be named once per leg and again under a "Fare
            // breakdown" whose one row equals the total directly beneath it.
            const { container } = render(
                <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />
            );
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

            expect(screen.queryByText('Fare breakdown')).not.toBeInTheDocument();
            expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1);
            // The cabin is still stated, and the total still stands alone.
            expect(screen.getByText('Class: Economy')).toBeInTheDocument();
            expect(screen.getByText('Estimated Total')).toBeInTheDocument();
        });

        it('breaks the fare down once there is someone to compare against', async () => {
            const { container } = renderRoundTrip();
            fillTraveler(container);

            fireEvent.click(screen.getByText('+ Add Traveler'));
            fireEvent.change(screen.getAllByPlaceholderText('John')[1], { target: { value: 'Grace' } });
            fireEvent.change(screen.getAllByPlaceholderText('Doe')[1], { target: { value: 'Hopper' } });
            fireEvent.change(container.querySelectorAll('input[type="date"]')[1], { target: { value: '1906-12-09' } });
            fireEvent.change(screen.getAllByPlaceholderText('A00000000')[1], { target: { value: 'US4440000' } });

            fireEvent.click(screen.getByText('Select Seats →'));
            // Seat the whole group on each leg in turn.
            fireEvent.click(screen.getByText(/Auto-Assign Adjacent Seats/i));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByText(/Auto-Assign Adjacent Seats/i));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');

            expect(screen.getByText('Fare breakdown')).toBeInTheDocument();
            // Named once per leg above, then once more against their fare.
            expect(screen.getAllByText('Ada Lovelace')).toHaveLength(3);
            expect(screen.getAllByText('Class: Economy')).toHaveLength(2);

            // Asserted row by row. A card that merely *contains* both names and
            // both seats reads identically whether or not each traveller is
            // paired with the seat they actually hold, so whole-card assertions
            // cannot see the defect this change exists to fix. The list is
            // reached by its accessible name, which pins that too.
            const [departing, returning] = screen.getAllByTestId('review-leg');
            const seatRows = (leg: HTMLElement, flightNumber: string) =>
                within(within(leg).getByRole('list', { name: `Travellers on Test Air ${flightNumber}` }))
                    .getAllByRole('listitem');

            const [adaOut, graceOut] = seatRows(departing, 'GA404');
            expect(adaOut).toHaveTextContent('Ada Lovelace');
            expect(adaOut).toHaveTextContent('Seat 11A');
            expect(graceOut).toHaveTextContent('Grace Hopper');
            expect(graceOut).toHaveTextContent('Seat 11B');

            const [adaBack, graceBack] = seatRows(returning, 'GA405');
            expect(adaBack).toHaveTextContent('Ada Lovelace');
            expect(adaBack).toHaveTextContent('Seat 11A');
            expect(graceBack).toHaveTextContent('Grace Hopper');
            expect(graceBack).toHaveTextContent('Seat 11B');
        });

        it('labels a middle leg by position rather than calling it a return', () => {
            // MAX_ITINERARY_LEGS caps this at two today, so a third leg is not
            // reachable through the app. Connecting itineraries (#131) make it
            // so, and "Returning" belongs to the last leg, not the second.
            const middleFlight = { ...inboundFlight, id: 44, flightNumber: 'GA406' };
            const { container } = render(
                <BookingCheckoutWizard
                    flights={[sampleFlight, middleFlight, inboundFlight]}
                    occupiedSeats={[[], [], []]}
                />
            );
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            const tabs = screen.getAllByRole('tab');
            expect(tabs).toHaveLength(3);
            expect(tabs[0]).toHaveTextContent('Departing');
            expect(tabs[1]).toHaveTextContent('Leg 2');
            expect(tabs[2]).toHaveTextContent('Returning');
        });

        it('books both legs with the seat chosen for each', async () => {
            mockBookFlightAction.mockResolvedValue({ id: 900, bookingReference: 'RT12345' });

            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));

            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
            // Each seat sits under its own leg rather than in one pooled list.
            const [departing, returning] = screen.getAllByTestId('review-leg');
            expect(departing).toHaveTextContent('Seat 11A');
            expect(returning).toHaveTextContent('Seat 12C');

            fireEvent.click(await preparePayment('$250'));

            await waitFor(() => {
                const checkoutId = mockHoldChosenSeatsAction.mock.calls[0][0].checkoutId;
                expect(mockBookFlightAction).toHaveBeenCalledWith({
                    flightIds: [42, 43],
                    passengers: [{
                        firstName: 'Ada',
                        lastName: 'Lovelace',
                        dateOfBirth: new Date('1990-01-01').toISOString(),
                        passportNumber: 'US5550000',
                        gender: 'Male',
                        seatNumbers: ['11A', '12C'],
                        cabinClass: 'ECONOMY'
                    }],
                    // One checkout owns both the temporary claims and the
                    // idempotent booking that will eventually consume them.
                    idempotencyKey: checkoutId
                });
            });
        });

        it('gives each leg its own boarding pass carrying that leg’s seat', async () => {
            // The boarding pass used to print a single seat for the whole
            // itinerary, which was the outbound seat labelled as the seat for
            // the trip. A return traveller read the wrong seat off their own
            // e-ticket (#137).
            mockBookFlightAction.mockResolvedValue({
                id: 900,
                totalPriceCents: 25000,
                passengers: [{
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    seatNumbers: ['11A', '12C'],
                    cabinClass: 'ECONOMY',
                }],
            });

            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));

            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
            fireEvent.click(await preparePayment('$250'));

            await waitFor(() => {
                expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
            });

            // The carrier on the e-ticket is the product. It read "GEMINI
            // AIRWAYS" until #158, and the source scan that was supposed to
            // catch that was case-sensitive. The negative is the assertion
            // carrying the regression value; the count is one per pass — one
            // traveller over two legs.
            expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
            expect(screen.getAllByText('MONA AIRWAYS')).toHaveLength(2);

            // A pass per leg: each names its own flight and carries the seat
            // held on it, rather than one card listing the whole itinerary.
            expect(screen.getByText('GA404')).toBeInTheDocument();
            expect(screen.getByText('GA405')).toBeInTheDocument();
            expect(screen.getByText('11A')).toBeInTheDocument();
            expect(screen.getByText('12C')).toBeInTheDocument();
            // The seats must not be pooled onto a single card.
            expect(screen.queryByText('11A, 12C')).not.toBeInTheDocument();
        });

        it('prints the cabin in words on the boarding pass', async () => {
            // The badge printed the enum, so an e-ticket read PREMIUM_ECONOMY —
            // underscore and capitals — on the artefact people keep (#169).
            mockBookFlightAction.mockResolvedValue({
                id: 901,
                totalPriceCents: 25000,
                passengers: [{
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    seatNumbers: ['11A', '12C'],
                    cabinClass: 'PREMIUM_ECONOMY',
                }],
            });

            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));
            fireEvent.click(screen.getByText('Review Booking →'));
        // Advancing now awaits the seat hold (#74), so step 3 arrives
        // after the click rather than during it.
        await screen.findByText('Review Booking');
            fireEvent.click(await preparePayment('$250'));

            await waitFor(() => {
                expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
            });

            expect(screen.getAllByText('Premium Economy')).toHaveLength(2);
            expect(screen.queryByText(/PREMIUM_ECONOMY/)).not.toBeInTheDocument();
        });

        it('clears every leg when the cabin changes, not just the visible one', () => {
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));

            // Back to travellers, upgrade the cabin: seats from the old cabin no
            // longer exist on either leg's map.
            fireEvent.click(screen.getByText('← Back'));
            fireEvent.change(container.querySelectorAll('select')[1], { target: { value: 'BUSINESS' } });
            fireEvent.click(screen.getByText('Select Seats →'));

            expect(screen.getAllByRole('tab')[0]).toHaveTextContent('seat needed');
            expect(screen.getAllByRole('tab')[1]).toHaveTextContent('seat needed');
        });
    });
});
