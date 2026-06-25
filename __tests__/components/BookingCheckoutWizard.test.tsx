import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    price: '$100'
};

describe('BookingCheckoutWizard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders Step 1 (Travelers) and calculates prices correctly based on cabin class and additions', async () => {
        const { container } = render(<BookingCheckoutWizard flight={sampleFlight} occupiedSeats={[]} />);

        // Header and Step 1 indicator
        expect(screen.getByText('Traveler Information')).toBeInTheDocument();
        expect(screen.getByText('Passenger #1')).toBeInTheDocument();

        // Total price should initially be $100 (Economy)
        expect(screen.getByText('Total: $100')).toBeInTheDocument();

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
        expect(screen.getByText('Total: $200')).toBeInTheDocument();

        // Add a second passenger
        fireEvent.click(screen.getByText('+ Add Traveler'));
        expect(screen.getByText('Passenger #2')).toBeInTheDocument();

        // Total price should be $200 (Passenger 1: Business) + $100 (Passenger 2: Economy) = $300
        expect(screen.getByText('Total: $300')).toBeInTheDocument();

        // Remove Passenger #2
        const removeButtons = screen.getAllByText('✕ Remove');
        fireEvent.click(removeButtons[1]);

        // Verify Passenger #2 is removed and price updates back to $200
        expect(screen.queryByText('Passenger #2')).not.toBeInTheDocument();
        expect(screen.getByText('Total: $200')).toBeInTheDocument();
    });

    it('shows validation errors in Step 1 if fields are missing', async () => {
        render(<BookingCheckoutWizard flight={sampleFlight} occupiedSeats={[]} />);

        // Try to proceed without entering details
        fireEvent.click(screen.getByText('Select Seats →'));

        // Expect warning message
        expect(screen.getByText(/Please fill out all details for Passenger 1/i)).toBeInTheDocument();
    });

    it('transitions to Step 2 (Seats) and lets passengers select seats, respecting occupied seats', async () => {
        const { container } = render(<BookingCheckoutWizard flight={sampleFlight} occupiedSeats={['4B']} />);

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
        fireEvent.click(screen.getByText('Billing & Summary →'));
        expect(screen.getByText('Review & Purchase')).toBeInTheDocument();
    });

    it('validates card payment details and completes booking successfully (Step 3 & 4)', async () => {
        mockBookFlightAction.mockResolvedValue({
            id: 12345,
            paymentIntentId: 'ch_mock123'
        });

        const { container } = render(<BookingCheckoutWizard flight={sampleFlight} occupiedSeats={[]} />);

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
        fireEvent.click(screen.getByText('Billing & Summary →'));

        // Verify summary details are correct
        expect(screen.getByText('Bob Jones')).toBeInTheDocument();
        expect(screen.getByText('Class: ECONOMY | Seat: 11C')).toBeInTheDocument();
        expect(screen.getByText('Total Price')).toBeInTheDocument();

        // Try to pay with invalid card number
        fireEvent.click(screen.getByRole('button', { name: /Pay \$100 & Book/i }));
        expect(screen.getByText(/Card number must be 16 digits/i)).toBeInTheDocument();

        // Fill card info properly
        fireEvent.change(screen.getByPlaceholderText('4111 2222 3333 4444'), { target: { value: '4111 2222 3333 4444' } });
        fireEvent.change(screen.getByPlaceholderText('JOHN DOE'), { target: { value: 'BOB JONES' } });
        fireEvent.change(screen.getByPlaceholderText('MM/YY'), { target: { value: '12/29' } });
        fireEvent.change(screen.getByPlaceholderText('123'), { target: { value: '123' } });

        // Submit Booking
        fireEvent.click(screen.getByRole('button', { name: /Pay \$100 & Book/i }));

        // Wait for step 4 success page
        await waitFor(() => {
            expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
            expect(mockBookFlightAction).toHaveBeenCalledTimes(1);
            expect(mockBookFlightAction).toHaveBeenCalledWith({
                flightId: 42,
                totalPrice: '$100',
                passengers: [{
                    firstName: 'Bob',
                    lastName: 'Jones',
                    dateOfBirth: new Date('1988-12-01').toISOString(),
                    passportNumber: 'US9876543',
                    gender: 'Male',
                    seatNumber: '11C',
                    cabinClass: 'ECONOMY'
                }],
                paymentIntentId: expect.any(String)
            });
        });

        // Verify Boarding Pass renders details
        expect(screen.getByText('Bob Jones')).toBeInTheDocument();
        expect(screen.getByText('GA404')).toBeInTheDocument();
        expect(screen.getByText('11C')).toBeInTheDocument();
        expect(screen.getByText('ECONOMY')).toBeInTheDocument();
    });

    it('shows action booking submission error on API failure', async () => {
        mockBookFlightAction.mockRejectedValue(new Error('Seats already taken!'));

        const { container } = render(<BookingCheckoutWizard flight={sampleFlight} occupiedSeats={[]} />);

        // Fill passenger details
        fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'John' } });
        fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Doe' } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1970-01-01' } });
        fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'PP12345' } });

        // Seats Step
        fireEvent.click(screen.getByText('Select Seats →'));
        fireEvent.click(screen.getByTitle('Select Seat 11D'));

        // Payment Step
        fireEvent.click(screen.getByText('Billing & Summary →'));

        // Fill card info
        fireEvent.change(screen.getByPlaceholderText('4111 2222 3333 4444'), { target: { value: '4111222233334444' } });
        fireEvent.change(screen.getByPlaceholderText('JOHN DOE'), { target: { value: 'JOHN DOE' } });
        fireEvent.change(screen.getByPlaceholderText('MM/YY'), { target: { value: '09/27' } });
        fireEvent.change(screen.getByPlaceholderText('123'), { target: { value: '321' } });

        // Submit Booking
        fireEvent.click(screen.getByRole('button', { name: /Pay \$100 & Book/i }));

        // Check if error is displayed
        await waitFor(() => {
            expect(screen.getByText(/Seats already taken!/i)).toBeInTheDocument();
        });
    });
});
