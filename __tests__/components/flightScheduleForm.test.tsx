/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightScheduleForm from '@/components/ui/flightScheduleForm';
import { saveFlightScheduleAction } from '@/app/actions';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        refresh: mockRefresh,
    }),
}));

jest.mock('@/app/actions', () => ({
    saveFlightScheduleAction: jest.fn(),
}));

const mockSaveFlightScheduleAction = saveFlightScheduleAction as jest.Mock;

describe('FlightScheduleForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders all form inputs and the submit button', () => {
        render(<FlightScheduleForm />);

        expect(screen.getByText('Create Flight Schedule')).toBeInTheDocument();
        expect(screen.getByLabelText(/Flight Number \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Airline Name \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/From \(Origin\) \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/To \(Destination\) \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Departure \(HH:MM\) \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Price \(\$\) \*/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create Schedule' })).toBeInTheDocument();

        // Check that weekdays checkboxes are present
        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayLabels.forEach(day => {
            expect(screen.getByLabelText(day)).toBeInTheDocument();
        });
    });

    it('offers no return time, because a return is a schedule of its own', () => {
        // A return time here promised inventory it could not create: since #113
        // a route operates in both directions by having a schedule each way.
        render(<FlightScheduleForm />);

        expect(screen.queryByLabelText(/Return Time/i)).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/One-Way/i)).not.toBeInTheDocument();
    });

    it('pre-populates the form when initialSchedule is provided', () => {
        const initialSchedule = {
            id: 42,
            flightNumber: 'AA123',
            airline: 'American Airlines',
            from: 'New York',
            to: 'London',
            departureTime: '14:30',
            durationMinutes: 245,
            daysOfWeek: [1, 3, 5],
            priceCents: 85000,
        };

        render(<FlightScheduleForm initialSchedule={initialSchedule} />);

        expect(screen.getByText('Edit Flight Schedule')).toBeInTheDocument();
        expect(screen.getByLabelText(/Flight Number \*/i)).toHaveValue('AA123');
        expect(screen.getByLabelText(/Airline Name \*/i)).toHaveValue('American Airlines');
        expect(screen.getByLabelText(/From \(Origin\) \*/i)).toHaveValue('New York');
        expect(screen.getByLabelText(/To \(Destination\) \*/i)).toHaveValue('London');
        expect(screen.getByLabelText(/Departure \(HH:MM\) \*/i)).toHaveValue('14:30');
        expect(screen.getByLabelText(/Price \(\$\) \*/i)).toHaveValue('$850');

        // Check if checkboxes are checked
        expect(screen.getByLabelText('Mon')).toBeChecked();
        expect(screen.getByLabelText('Wed')).toBeChecked();
        expect(screen.getByLabelText('Fri')).toBeChecked();
        expect(screen.getByLabelText('Tue')).not.toBeChecked();
    });

    it('shows validation error if required fields are missing', async () => {
        render(<FlightScheduleForm />);
        
        // Try submitting empty form
        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(screen.getByText(/Please fill in all required fields/i)).toBeInTheDocument();
        });
        expect(mockSaveFlightScheduleAction).not.toHaveBeenCalled();
    });

    it('shows validation error if departure time has invalid format', async () => {
        render(<FlightScheduleForm />);

        // Fill required fields
        fireEvent.change(screen.getByLabelText(/Flight Number \*/i), { target: { value: 'AA123' } });
        fireEvent.change(screen.getByLabelText(/Airline Name \*/i), { target: { value: 'American Airlines' } });
        fireEvent.change(screen.getByLabelText(/From \(Origin\) \*/i), { target: { value: 'New York' } });
        fireEvent.change(screen.getByLabelText(/To \(Destination\) \*/i), { target: { value: 'London' } });
        fireEvent.change(screen.getByLabelText(/Price \(\$\) \*/i), { target: { value: '850' } });

        // A duration, so the form reaches the departure-format check rather
        // than stopping on a missing required field.
        fireEvent.change(screen.getByLabelText(/Duration \(minutes\) \*/i), { target: { value: '245' } });

        // Invalid departure format
        fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\) \*/i), { target: { value: '8:0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));
        await waitFor(() => {
            expect(screen.getByText(/Departure time must be in HH:MM format/i)).toBeInTheDocument();
        });

        expect(mockSaveFlightScheduleAction).not.toHaveBeenCalled();
    });

    it('shows validation error if no days of the week are selected', async () => {
        render(<FlightScheduleForm />);

        fireEvent.change(screen.getByLabelText(/Flight Number \*/i), { target: { value: 'AA123' } });
        fireEvent.change(screen.getByLabelText(/Airline Name \*/i), { target: { value: 'American Airlines' } });
        fireEvent.change(screen.getByLabelText(/From \(Origin\) \*/i), { target: { value: 'New York' } });
        fireEvent.change(screen.getByLabelText(/To \(Destination\) \*/i), { target: { value: 'London' } });
        fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\) \*/i), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText(/Duration \(minutes\) \*/i), { target: { value: '245' } });
        fireEvent.change(screen.getByLabelText(/Price \(\$\) \*/i), { target: { value: '850' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(screen.getByText(/Please select at least one day of the week/i)).toBeInTheDocument();
        });
        expect(mockSaveFlightScheduleAction).not.toHaveBeenCalled();
    });

    it('submits correctly and displays success message on create', async () => {
        mockSaveFlightScheduleAction.mockResolvedValue({ id: 1 });

        render(<FlightScheduleForm />);

        fireEvent.change(screen.getByLabelText(/Flight Number \*/i), { target: { value: 'AA123' } });
        fireEvent.change(screen.getByLabelText(/Airline Name \*/i), { target: { value: 'American Airlines' } });
        fireEvent.change(screen.getByLabelText(/From \(Origin\) \*/i), { target: { value: 'New York' } });
        fireEvent.change(screen.getByLabelText(/To \(Destination\) \*/i), { target: { value: 'London' } });
        fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\) \*/i), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText(/Duration \(minutes\) \*/i), { target: { value: '245' } });
        fireEvent.change(screen.getByLabelText(/Price \(\$\) \*/i), { target: { value: '850' } });
        
        // Select Mon (1) and Wed (3)
        fireEvent.click(screen.getByLabelText('Mon'));
        fireEvent.click(screen.getByLabelText('Wed'));

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(mockSaveFlightScheduleAction).toHaveBeenCalledWith({
                id: undefined,
                flightNumber: 'AA123',
                airline: 'American Airlines',
                from: 'New York',
                to: 'London',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1, 3],
                price: '$850', // automatically formats with $ if missing
                firstClassRows: 3,
                businessRows: 3,
                premiumEconomyRows: 4,
                economyRows: 20,
                seatPattern: 'ABC-DEF',
            });
            expect(screen.getByText(/New schedule created successfully!/i)).toBeInTheDocument();
            expect(mockRefresh).toHaveBeenCalled();
        });

        // Verifies form fields are cleared after successful create
        expect(screen.getByLabelText(/Flight Number \*/i)).toHaveValue('');
        expect(screen.getByLabelText(/Airline Name \*/i)).toHaveValue('');
        expect(screen.getByLabelText(/From \(Origin\) \*/i)).toHaveValue('');
        expect(screen.getByLabelText(/To \(Destination\) \*/i)).toHaveValue('');
        expect(screen.getByLabelText(/Departure \(HH:MM\) \*/i)).toHaveValue('');
        // Left behind, the next schedule on a different route silently inherits
        // this one's block time -- and there is no Duration column in the list
        // and no edit form to notice it with (#84).
        expect(screen.getByLabelText(/Duration \(minutes\) \*/i)).toHaveValue(null);
        expect(screen.getByLabelText(/Price \(\$\) \*/i)).toHaveValue('');
        expect(screen.getByLabelText('Mon')).not.toBeChecked();
        expect(screen.getByLabelText('Wed')).not.toBeChecked();
    });

    it('submits correctly and displays success message on edit', async () => {
        mockSaveFlightScheduleAction.mockResolvedValue({ id: 42 });

        const initialSchedule = {
            id: 42,
            flightNumber: 'AA123',
            airline: 'American Airlines',
            from: 'New York',
            to: 'London',
            departureTime: '14:30',
            durationMinutes: 245,
            daysOfWeek: [1],
            priceCents: 85000,
        };

        render(<FlightScheduleForm initialSchedule={initialSchedule} />);

        // Toggle Mon (remove it) and add Sat (6)
        fireEvent.click(screen.getByLabelText('Mon'));
        fireEvent.click(screen.getByLabelText('Sat'));

        fireEvent.click(screen.getByRole('button', { name: 'Update Schedule' }));

        await waitFor(() => {
            expect(mockSaveFlightScheduleAction).toHaveBeenCalledWith({
                id: 42,
                flightNumber: 'AA123',
                airline: 'American Airlines',
                from: 'New York',
                to: 'London',
                departureTime: '14:30',
                durationMinutes: 245,
                daysOfWeek: [6],
                price: '$850',
                firstClassRows: 3,
                businessRows: 3,
                premiumEconomyRows: 4,
                economyRows: 20,
                seatPattern: 'ABC-DEF',
            });
            expect(screen.getByText(/Schedule updated successfully!/i)).toBeInTheDocument();
            expect(mockRefresh).toHaveBeenCalled();
        });

        // Verifies form fields are NOT cleared after edit
        expect(screen.getByLabelText(/Flight Number \*/i)).toHaveValue('AA123');
    });

    it('shows action error if save action fails', async () => {
        mockSaveFlightScheduleAction.mockRejectedValue(new Error('Server database connection failed'));

        render(<FlightScheduleForm />);

        fireEvent.change(screen.getByLabelText(/Flight Number \*/i), { target: { value: 'AA123' } });
        fireEvent.change(screen.getByLabelText(/Airline Name \*/i), { target: { value: 'American Airlines' } });
        fireEvent.change(screen.getByLabelText(/From \(Origin\) \*/i), { target: { value: 'New York' } });
        fireEvent.change(screen.getByLabelText(/To \(Destination\) \*/i), { target: { value: 'London' } });
        fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\) \*/i), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText(/Duration \(minutes\) \*/i), { target: { value: '245' } });
        fireEvent.change(screen.getByLabelText(/Price \(\$\) \*/i), { target: { value: '850' } });
        fireEvent.click(screen.getByLabelText('Mon'));

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(screen.getByText(/Server database connection failed/i)).toBeInTheDocument();
        });
    });

    it('allows toggling custom seating configuration panel and submits default layout parameters when checked', async () => {
        mockSaveFlightScheduleAction.mockResolvedValue({ id: 100 });

        render(<FlightScheduleForm />);

        fireEvent.change(screen.getByLabelText(/Flight Number \*/i), { target: { value: 'AA123' } });
        fireEvent.change(screen.getByLabelText(/Airline Name \*/i), { target: { value: 'American Airlines' } });
        fireEvent.change(screen.getByLabelText(/From \(Origin\) \*/i), { target: { value: 'New York' } });
        fireEvent.change(screen.getByLabelText(/To \(Destination\) \*/i), { target: { value: 'London' } });
        fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\) \*/i), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText(/Duration \(minutes\) \*/i), { target: { value: '245' } });
        fireEvent.change(screen.getByLabelText(/Price \(\$\) \*/i), { target: { value: '850' } });
        fireEvent.click(screen.getByLabelText('Mon'));

        // Toggle custom seating panel
        const toggleButton = screen.getByRole('button', { name: /Customize Seating Configuration/i });
        fireEvent.click(toggleButton);

        // Check if layout inputs are now visible
        expect(screen.getByLabelText(/First Class Rows/i)).toHaveValue(3);
        expect(screen.getByLabelText(/Economy Class Rows/i)).toHaveValue(20);
        expect(screen.getByLabelText(/Seat Pattern/i)).toHaveValue('ABC-DEF');

        // Modify a seating configuration field
        fireEvent.change(screen.getByLabelText(/First Class Rows/i), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Seat Pattern/i), { target: { value: 'AC-DF' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(mockSaveFlightScheduleAction).toHaveBeenCalledWith({
                id: undefined,
                flightNumber: 'AA123',
                airline: 'American Airlines',
                from: 'New York',
                to: 'London',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1],
                price: '$850',
                firstClassRows: 3,
                businessRows: 3,
                premiumEconomyRows: 4,
                economyRows: 20,
                seatPattern: 'AC-DF'
            });
        });
    });

    it('shows validation error if seat pattern format is invalid', async () => {
        render(<FlightScheduleForm />);

        fireEvent.change(screen.getByLabelText(/Flight Number \*/i), { target: { value: 'AA123' } });
        fireEvent.change(screen.getByLabelText(/Airline Name \*/i), { target: { value: 'American Airlines' } });
        fireEvent.change(screen.getByLabelText(/From \(Origin\) \*/i), { target: { value: 'New York' } });
        fireEvent.change(screen.getByLabelText(/To \(Destination\) \*/i), { target: { value: 'London' } });
        fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\) \*/i), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText(/Duration \(minutes\) \*/i), { target: { value: '245' } });
        fireEvent.change(screen.getByLabelText(/Price \(\$\) \*/i), { target: { value: '850' } });
        fireEvent.click(screen.getByLabelText('Mon'));

        // Toggle and enter invalid pattern
        const toggleButton = screen.getByRole('button', { name: /Customize Seating Configuration/i });
        fireEvent.click(toggleButton);
        fireEvent.change(screen.getByLabelText(/Seat Pattern/i), { target: { value: '123-ABC' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(screen.getByText(/Seat pattern must only contain uppercase letters and/i)).toBeInTheDocument();
        });
        expect(mockSaveFlightScheduleAction).not.toHaveBeenCalled();
    });
});
