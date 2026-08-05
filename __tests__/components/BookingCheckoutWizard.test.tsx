import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';
import { bookFlightAction } from '@/app/actions';

// Mock the server action
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
}));

const mockBookFlightAction = bookFlightAction as jest.Mock;

const sampleFlight = {
    id: 42,
    flightNumber: 'GA404',
    airline: 'Gemini Airways',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    departureDate: '2026-06-30T10:00:00Z',
    priceCents: 10000
};

describe('BookingCheckoutWizard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
        expect(screen.getByText('Review Booking')).toBeInTheDocument();
    });

    it('confirms a server-priced booking without collecting payment card data', async () => {
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

        // Verify summary details are correct. The seat is read off the leg it
        // is held on, and the fare breakdown carries the cabin (#152).
        expect(screen.getByTestId('review-leg')).toHaveTextContent('Bob Jones');
        expect(screen.getByTestId('review-leg')).toHaveTextContent('Seat 11C');
        expect(screen.getByText('Class: ECONOMY')).toBeInTheDocument();
        expect(screen.getByText('Estimated Total')).toBeInTheDocument();

        expect(screen.queryByPlaceholderText('4111 2222 3333 4444')).not.toBeInTheDocument();
        expect(screen.getByText(/Payment is not collected in this demo/i)).toBeInTheDocument();

        // Submit Booking
        fireEvent.click(screen.getByRole('button', { name: /Confirm \$100 booking/i }));

        // Wait for step 4 success page
        await waitFor(() => {
            expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
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

        // Verify Boarding Pass renders details
        expect(screen.getByText('Robert Jones')).toBeInTheDocument();
        expect(screen.getByText('GA404')).toBeInTheDocument();
        expect(screen.getByText('11C')).toBeInTheDocument();
        expect(screen.getByText('ECONOMY')).toBeInTheDocument();
    });

    it('shows action booking submission error on API failure', async () => {
        mockBookFlightAction.mockRejectedValue(new Error('Seats already taken!'));

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

        // Submit Booking
        fireEvent.click(screen.getByRole('button', { name: /Confirm \$100 booking/i }));

        // Check if error is displayed
        await waitFor(() => {
            expect(screen.getByText(/Seats already taken!/i)).toBeInTheDocument();
        });
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

        fireEvent.click(screen.getByRole('button', { name: /Confirm \$100 booking/i }));

        const pendingButton = screen.getByRole('button', { name: /Confirming Booking/i });
        expect(pendingButton).toBeDisabled();
        expect(pendingButton).toHaveAttribute('aria-busy', 'true');
        expect(pendingButton).toHaveStyle({ opacity: '0.65', cursor: 'not-allowed' });
        expect(screen.getByRole('status')).toHaveTextContent('Confirming booking and checking availability.');

        resolveBooking({
            id: 12345,
            totalPriceCents: 10000,
            passengers: [{ firstName: 'Bob', lastName: 'Jones', seatNumbers: ['11C'], cabinClass: 'ECONOMY' }]
        });
        await waitFor(() => expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument());
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
        fireEvent.click(screen.getByRole('button', { name: /Confirm \$100 booking/i }));

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
        fireEvent.click(screen.getByRole('button', { name: /Confirm \$100 booking/i }));

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
        fireEvent.click(screen.getByRole('button', { name: /Confirm \$100 booking/i }));

        await waitFor(() => expect(screen.getByText('Select Your Seats')).toBeInTheDocument());
        const passengerTarget = screen.getByRole('button', { name: /Bob Jones.*Seat: 11C/i });
        expect(passengerTarget).toHaveAttribute('data-invalid', 'true');
        expect(passengerTarget).toHaveAccessibleDescription('Seat number is invalid.');
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

            // Go back to the departing leg so the error has a leg to correct.
            fireEvent.click(screen.getByText('← Back'));
            fireEvent.click(screen.getByRole('tab', { name: /Departing/ }));
            fireEvent.click(screen.getByText('Review Booking →'));
            fireEvent.click(screen.getByRole('button', { name: /Confirm \$250 booking/i }));

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
            expect(screen.getByRole('heading', { name: 'Review Booking' })).toBeInTheDocument();
        });

        it('reviews every leg of the itinerary, not just the last one opened', () => {
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

            const legs = screen.getAllByTestId('review-leg');
            expect(legs).toHaveLength(2);

            expect(legs[0]).toHaveTextContent('Departing');
            expect(legs[0]).toHaveTextContent('GA404');
            expect(legs[0]).toHaveTextContent('Seattle, USA → Detroit, USA');

            expect(legs[1]).toHaveTextContent('Returning');
            expect(legs[1]).toHaveTextContent('GA405');
            expect(legs[1]).toHaveTextContent('Detroit, USA → Seattle, USA');
        });

        it('shows each seat against the leg it is held on', () => {
            // Seats were pooled into one comma list with nothing saying which
            // seat belonged to which flight (#152).
            const { container } = renderRoundTrip();
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));

            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByRole('tab', { name: /Returning/ }));
            fireEvent.click(screen.getByTitle('Select Seat 12C'));
            fireEvent.click(screen.getByText('Review Booking →'));

            const [departing, returning] = screen.getAllByTestId('review-leg');
            expect(departing).toHaveTextContent('Ada Lovelace');
            expect(departing).toHaveTextContent('11A');
            expect(departing).not.toHaveTextContent('12C');

            expect(returning).toHaveTextContent('Ada Lovelace');
            expect(returning).toHaveTextContent('12C');
            expect(returning).not.toHaveTextContent('11A');
        });

        it('still names one leg and one seat on a one-way review', () => {
            const { container } = render(
                <BookingCheckoutWizard flights={[sampleFlight]} occupiedSeats={[[]]} />
            );
            fillTraveler(container);
            fireEvent.click(screen.getByText('Select Seats →'));
            fireEvent.click(screen.getByTitle('Select Seat 11A'));
            fireEvent.click(screen.getByText('Review Booking →'));

            const legs = screen.getAllByTestId('review-leg');
            expect(legs).toHaveLength(1);
            expect(legs[0]).toHaveTextContent('GA404');
            expect(legs[0]).toHaveTextContent('11A');
            // A single leg is not a direction; the eyebrow belongs to a trip
            // that has more than one.
            expect(legs[0]).not.toHaveTextContent('Departing');
        });

        it('does not bill a lone traveller in a breakdown of one row', () => {
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

            expect(screen.queryByText('Fare breakdown')).not.toBeInTheDocument();
            expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1);
            // The cabin is still stated, and the total still stands alone.
            expect(screen.getByText('Class: ECONOMY')).toBeInTheDocument();
            expect(screen.getByText('Estimated Total')).toBeInTheDocument();
        });

        it('breaks the fare down once there is someone to compare against', () => {
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

            expect(screen.getByText('Fare breakdown')).toBeInTheDocument();
            // Named once per leg above, then once more against their fare.
            expect(screen.getAllByText('Ada Lovelace')).toHaveLength(3);
            expect(screen.getAllByText('Class: ECONOMY')).toHaveLength(2);

            // Asserted row by row. A card that merely *contains* both names and
            // both seats reads identically whether or not each traveller is
            // paired with the seat they actually hold, so whole-card assertions
            // cannot see the defect this change exists to fix. The list is
            // reached by its accessible name, which pins that too.
            const [departing, returning] = screen.getAllByTestId('review-leg');
            const seatRows = (leg: HTMLElement, flightNumber: string) =>
                within(within(leg).getByRole('list', { name: `Travellers on Gemini Airways ${flightNumber}` }))
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
            // Each seat sits under its own leg rather than in one pooled list.
            const [departing, returning] = screen.getAllByTestId('review-leg');
            expect(departing).toHaveTextContent('Seat 11A');
            expect(returning).toHaveTextContent('Seat 12C');

            fireEvent.click(screen.getByRole('button', { name: /Confirm \$250 booking/i }));

            await waitFor(() => {
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
                    idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i)
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
            fireEvent.click(screen.getByRole('button', { name: /Confirm \$250 booking/i }));

            await waitFor(() => {
                expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
            });

            // A pass per leg: each names its own flight and carries the seat
            // held on it, rather than one card listing the whole itinerary.
            expect(screen.getByText('GA404')).toBeInTheDocument();
            expect(screen.getByText('GA405')).toBeInTheDocument();
            expect(screen.getByText('11A')).toBeInTheDocument();
            expect(screen.getByText('12C')).toBeInTheDocument();
            // The seats must not be pooled onto a single card.
            expect(screen.queryByText('11A, 12C')).not.toBeInTheDocument();
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
