/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ManualOccurrenceBuilder from '@/components/ui/ManualOccurrenceBuilder';
import { generateFlightOccurrencesAction } from '@/app/actions';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        refresh: mockRefresh,
    }),
}));

jest.mock('@/app/actions', () => ({
    generateFlightOccurrencesAction: jest.fn(),
}));

const mockGenerateAction = generateFlightOccurrencesAction as jest.Mock;

const sampleSchedules = [
    {
        id: 10,
        flightNumber: 'AA100',
        airline: 'American Airlines',
        from: 'JFK',
        to: 'LAX',
        departureTime: '08:00',
        daysOfWeek: [1, 3, 5],
        price: '$500',
        firstClassRows: 3,
        businessRows: 5,
        premiumEconomyRows: 6,
        economyRows: 25,
        seatPattern: 'AC-DF'
    },
    {
        id: 20,
        flightNumber: 'DL200',
        airline: 'Delta',
        from: 'ATL',
        to: 'SFO',
        departureTime: '12:00',
        daysOfWeek: [2, 4],
        price: '$600',
        firstClassRows: null,
        businessRows: null,
        premiumEconomyRows: null,
        economyRows: null,
        seatPattern: null
    }
];

describe('ManualOccurrenceBuilder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders schedule list select and date controls', () => {
        render(<ManualOccurrenceBuilder schedules={sampleSchedules} />);

        expect(screen.getByText('Manual Occurrence Generator')).toBeInTheDocument();
        expect(screen.getByLabelText(/Flight Template \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Start Date \*/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/End Date \*/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Generate Occurrences' })).toBeInTheDocument();
    });

    it('auto-fills seating configurations when template is selected', async () => {
        render(<ManualOccurrenceBuilder schedules={sampleSchedules} />);

        // Choose template AA100 (id 10)
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });

        // Inputs should be visible and populated
        expect(screen.getByLabelText(/First Class Rows/i)).toHaveValue(3);
        expect(screen.getByLabelText(/Business Class Rows/i)).toHaveValue(5);
        expect(screen.getByLabelText(/Premium Economy Rows/i)).toHaveValue(6);
        expect(screen.getByLabelText(/Economy Class Rows/i)).toHaveValue(25);
        expect(screen.getByLabelText(/Seat Pattern/i)).toHaveValue('AC-DF');

        // Choose template DL200 (id 20) with null values
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '20' } });

        // Should fall back to default values
        expect(screen.getByLabelText(/First Class Rows/i)).toHaveValue(3);
        expect(screen.getByLabelText(/Business Class Rows/i)).toHaveValue(3);
        expect(screen.getByLabelText(/Premium Economy Rows/i)).toHaveValue(4);
        expect(screen.getByLabelText(/Economy Class Rows/i)).toHaveValue(20);
        expect(screen.getByLabelText(/Seat Pattern/i)).toHaveValue('ABC-DEF');
    });

    it('submits parameters correctly to generateFlightOccurrencesAction', async () => {
        mockGenerateAction.mockResolvedValue({ success: true, count: 5, created: 3, updated: 2 });

        render(<ManualOccurrenceBuilder schedules={sampleSchedules} />);

        // Fill form fields
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/Start Date \*/i), { target: { value: '2026-07-10' } });
        fireEvent.change(screen.getByLabelText(/End Date \*/i), { target: { value: '2026-07-20' } });

        // Override business rows and seat pattern
        fireEvent.change(screen.getByLabelText(/Business Class Rows/i), { target: { value: '8' } });
        fireEvent.change(screen.getByLabelText(/Seat Pattern/i), { target: { value: 'AB-CD-EF' } });

        fireEvent.click(screen.getByRole('button', { name: 'Generate Occurrences' }));

        await waitFor(() => {
            expect(mockGenerateAction).toHaveBeenCalledWith(
                10,
                '2026-07-10',
                '2026-07-20',
                {
                    firstClassRows: 3,
                    businessRows: 8,
                    premiumEconomyRows: 6,
                    economyRows: 25,
                    seatPattern: 'AB-CD-EF'
                }
            );
            expect(screen.getByText(/Successfully affected 5 flight occurrence\(s\): 3 created, 2 updated/i)).toBeInTheDocument();
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('validates required inputs and showing warning logs', async () => {
        render(<ManualOccurrenceBuilder schedules={sampleSchedules} />);

        // Submit without template select
        fireEvent.click(screen.getByRole('button', { name: 'Generate Occurrences' }));
        await waitFor(() => {
            expect(screen.getByText(/Please select a repeating flight template/i)).toBeInTheDocument();
        });

        // Add template select, submit without dates
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate Occurrences' }));
        await waitFor(() => {
            expect(screen.getByText(/Please select both start and end dates/i)).toBeInTheDocument();
        });

        // Add invalid date range
        fireEvent.change(screen.getByLabelText(/Start Date \*/i), { target: { value: '2026-07-20' } });
        fireEvent.change(screen.getByLabelText(/End Date \*/i), { target: { value: '2026-07-10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate Occurrences' }));
        await waitFor(() => {
            expect(screen.getByText(/End date must be on or after start date/i)).toBeInTheDocument();
        });

        expect(mockGenerateAction).not.toHaveBeenCalled();
    });
});
