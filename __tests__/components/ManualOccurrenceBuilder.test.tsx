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
        priceCents: 50000,
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
        priceCents: 60000,
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

    it('explains how to recover when no active template is available', () => {
        render(<ManualOccurrenceBuilder schedules={[]} />);

        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent(
            'Activate or create a repeating flight template before generating occurrences.',
        );
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

    it('auto-fills and submits per-cabin award seat quota overrides to generateFlightOccurrencesAction', async () => {
        mockGenerateAction.mockResolvedValue({ success: true, count: 2, created: 2, updated: 0 });

        const schedulesWithAwardQuotas = [
            {
                ...sampleSchedules[0],
                awardSeatsFirst: 2,
                awardSeatsBusiness: 4,
                awardSeatsPremiumEconomy: 5,
                awardSeatsEconomy: 8,
            },
            {
                ...sampleSchedules[1],
                awardSeatsFirst: null,
                awardSeatsBusiness: null,
                awardSeatsPremiumEconomy: null,
                awardSeatsEconomy: null,
            },
        ];

        render(<ManualOccurrenceBuilder schedules={schedulesWithAwardQuotas} />);

        // Select schedule 10 with custom template quotas
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });

        expect(screen.getByLabelText('First Class Award Seats')).toHaveValue(2);
        expect(screen.getByLabelText('Business Award Seats')).toHaveValue(4);
        expect(screen.getByLabelText('Prem. Economy Award Seats')).toHaveValue(5);
        expect(screen.getByLabelText('Economy Award Seats')).toHaveValue(8);

        // Select schedule 20 with null template quotas -> falls back to 1/2/2/4
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '20' } });

        expect(screen.getByLabelText('First Class Award Seats')).toHaveValue(1);
        expect(screen.getByLabelText('Business Award Seats')).toHaveValue(2);
        expect(screen.getByLabelText('Prem. Economy Award Seats')).toHaveValue(2);
        expect(screen.getByLabelText('Economy Award Seats')).toHaveValue(4);

        // Switch back to schedule 10 and override award seat quotas
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/Start Date \*/i), { target: { value: '2026-07-10' } });
        fireEvent.change(screen.getByLabelText(/End Date \*/i), { target: { value: '2026-07-20' } });

        fireEvent.change(screen.getByLabelText('First Class Award Seats'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Business Award Seats'), { target: { value: '6' } });
        fireEvent.change(screen.getByLabelText('Prem. Economy Award Seats'), { target: { value: '7' } });
        fireEvent.change(screen.getByLabelText('Economy Award Seats'), { target: { value: '12' } });

        fireEvent.click(screen.getByRole('button', { name: 'Generate Occurrences' }));

        await waitFor(() => {
            expect(mockGenerateAction).toHaveBeenCalledWith(
                10,
                '2026-07-10',
                '2026-07-20',
                {
                    firstClassRows: 3,
                    businessRows: 5,
                    premiumEconomyRows: 6,
                    economyRows: 25,
                    seatPattern: 'AC-DF',
                    awardSeatsFirst: 3,
                    awardSeatsBusiness: 6,
                    awardSeatsPremiumEconomy: 7,
                    awardSeatsEconomy: 12,
                }
            );
        });
    });

    it('renders live cabin capacity and award quota summary when a template is selected and updates dynamically', () => {
        render(<ManualOccurrenceBuilder schedules={sampleSchedules} />);

        expect(screen.queryByTestId('manual-occurrence-capacity-summary')).not.toBeInTheDocument();

        // Select schedule 10: 3F, 5J, 6W, 25Y with AC-DF (4 seats/row) => 12F, 20J, 24W, 100Y = 156 total; default awards 1 + 2 + 2 + 4 = 9
        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });

        const summary = screen.getByTestId('manual-occurrence-capacity-summary');
        expect(summary).toHaveTextContent('Capacity: 156 total seats (12F · 20J · 24W · 100Y) · 9 award seats');

        // Change rows, seat pattern, and award seats
        fireEvent.change(screen.getByLabelText(/First Class Rows/i), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText(/Seat Pattern/i), { target: { value: 'ABC-DEF' } });
        fireEvent.change(screen.getByLabelText('Economy Award Seats'), { target: { value: '10' } });

        // Now 6 seats/row: 2*6=12F, 5*6=30J, 6*6=36W, 25*6=150Y => 228 total; awards 1 + 2 + 2 + 10 = 15
        expect(summary).toHaveTextContent('Capacity: 228 total seats (12F · 30J · 36W · 150Y) · 15 award seats');
    });

    it('shows validation error when a cabin award seat quota exceeds physical cabin capacity', async () => {
        render(<ManualOccurrenceBuilder schedules={sampleSchedules} />);

        fireEvent.change(screen.getByLabelText(/Flight Template \*/i), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/Start Date \*/i), { target: { value: '2026-07-10' } });
        fireEvent.change(screen.getByLabelText(/End Date \*/i), { target: { value: '2026-07-20' } });

        // Schedule 10 has 3 first class rows * 4 seats/row (AC-DF) = 12 physical seats; set award quota to 13
        fireEvent.change(screen.getByLabelText('First Class Award Seats'), { target: { value: '13' } });

        fireEvent.click(screen.getByRole('button', { name: 'Generate Occurrences' }));

        await waitFor(() => {
            expect(screen.getByText(/Award seat quota cannot exceed physical cabin capacity\./i)).toBeInTheDocument();
        });
        expect(mockGenerateAction).not.toHaveBeenCalled();
    });
});


