import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';
import {
    getOccupiedSeatsAction,
    rebookItineraryAction,
} from '@/app/actions';
import ItineraryRebookingDialog from '@/components/ui/ItineraryRebookingDialog';

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/app/actions', () => ({
    getOccupiedSeatsAction: jest.fn(),
    rebookItineraryAction: jest.fn(),
}));

const mockGetOccupiedSeats = getOccupiedSeatsAction as jest.Mock;
const mockRebook = rebookItineraryAction as jest.Mock;
const mockOnSuccess = jest.fn();

const passengers = [
    { id: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
    { id: 'grace', firstName: 'Grace', lastName: 'Hopper' },
];
const cancelledLegs = [
    {
        id: 11,
        seatAssignments: [
            { passengerId: 'ada', cabinClass: 'ECONOMY' },
            { passengerId: 'grace', cabinClass: 'BUSINESS' },
        ],
    },
    {
        id: 12,
        seatAssignments: [
            { passengerId: 'ada', cabinClass: 'ECONOMY' },
            { passengerId: 'grace', cabinClass: 'BUSINESS' },
        ],
    },
];
const layout = {
    durationMinutes: 120,
    status: 'ON_TIME' as const,
    firstClassRows: 0,
    businessRows: 1,
    premiumEconomyRows: 0,
    economyRows: 2,
    seatPattern: 'AB-CD',
};
const groups = [
    {
        fromLegId: 11,
        originalFlightNumber: 'MA100',
        originalDepartureDate: new Date('2026-08-20T16:00:00Z'),
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        flights: [
            { ...layout, id: 101, flightNumber: 'MA101', airline: 'Mona Airways', from: 'Seattle, USA', to: 'Detroit, USA', departureDate: new Date('2026-08-21T16:00:00Z') },
            { ...layout, id: 102, flightNumber: 'MA102', airline: 'Mona Airways', from: 'Seattle, USA', to: 'Detroit, USA', departureDate: new Date('2026-08-22T16:00:00Z') },
        ],
    },
    {
        fromLegId: 12,
        originalFlightNumber: 'MA200',
        originalDepartureDate: new Date('2026-08-25T16:00:00Z'),
        from: 'Detroit, USA',
        to: 'Seattle, USA',
        flights: [
            { ...layout, id: 201, flightNumber: 'MA201', airline: 'Mona Airways', from: 'Detroit, USA', to: 'Seattle, USA', departureDate: new Date('2026-08-26T16:00:00Z') },
        ],
    },
];

function renderDialog(
    legs = cancelledLegs,
    replacementGroups = groups,
) {
    return render(
        <ItineraryRebookingDialog
            bookingId={42}
            passengers={passengers}
            cancelledLegs={legs}
            groups={replacementGroups}
            onSuccess={mockOnSuccess}
        />,
    );
}

describe('ItineraryRebookingDialog', () => {
    const refresh = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({ refresh });
        mockGetOccupiedSeats.mockResolvedValue([]);
    });

    it('keeps every cancelled leg in one form and clears only the changed leg seats', async () => {
        let finishRebooking!: (result: { bookingId: number; status: string }) => void;
        mockRebook.mockReturnValue(new Promise(resolve => { finishRebooking = resolve; }));
        renderDialog();

        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        const dialog = screen.getByRole('dialog', { name: 'Rebook booking 42' });
        const flightSelects = within(dialog).getAllByLabelText(/Replacement flight for/);
        expect(flightSelects[0]).toHaveFocus();
        expect(within(dialog).getByRole('button', { name: 'Confirm replacement flights' }))
            .toBeDisabled();

        fireEvent.change(flightSelects[0], { target: { value: '101' } });
        fireEvent.change(flightSelects[1], { target: { value: '201' } });
        await waitFor(() => expect(mockGetOccupiedSeats).toHaveBeenCalledTimes(2));

        fireEvent.change(within(dialog).getByLabelText('Replacement seat for Ada Lovelace on MA101'), { target: { value: '2A' } });
        fireEvent.change(within(dialog).getByLabelText('Replacement seat for Grace Hopper on MA101'), { target: { value: '1A' } });
        fireEvent.change(within(dialog).getByLabelText('Replacement seat for Ada Lovelace on MA201'), { target: { value: '2B' } });
        fireEvent.change(within(dialog).getByLabelText('Replacement seat for Grace Hopper on MA201'), { target: { value: '1B' } });

        fireEvent.change(flightSelects[0], { target: { value: '102' } });
        expect(within(dialog).getByLabelText('Replacement seat for Ada Lovelace on MA102')).toHaveValue('');
        expect(within(dialog).getByLabelText('Replacement seat for Ada Lovelace on MA201')).toHaveValue('2B');
        fireEvent.change(within(dialog).getByLabelText('Replacement seat for Ada Lovelace on MA102'), { target: { value: '2A' } });
        fireEvent.change(within(dialog).getByLabelText('Replacement seat for Grace Hopper on MA102'), { target: { value: '1A' } });

        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm replacement flights' }));
        const pendingButton = await within(dialog).findByRole('button', {
            name: 'Confirming replacement flights…',
        });
        expect(pendingButton).toBeDisabled();
        expect(pendingButton).toHaveAttribute('aria-busy', 'true');
        await waitFor(() => expect(mockRebook).toHaveBeenCalledWith({
            bookingId: 42,
            replacements: [
                {
                    fromLegId: 11,
                    replacementFlightId: 102,
                    seats: [
                        { passengerId: 'ada', seatNumber: '2A' },
                        { passengerId: 'grace', seatNumber: '1A' },
                    ],
                },
                {
                    fromLegId: 12,
                    replacementFlightId: 201,
                    seats: [
                        { passengerId: 'ada', seatNumber: '2B' },
                        { passengerId: 'grace', seatNumber: '1B' },
                    ],
                },
            ],
        }));
        await act(async () => finishRebooking({ bookingId: 42, status: 'CONFIRMED' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mockOnSuccess).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalled();
    });

    it('distinguishes scheduled occurrences that share a flight number', () => {
        renderDialog(cancelledLegs, [{
            ...groups[0],
            flights: groups[0].flights.map(flight => ({
                ...flight,
                flightNumber: 'MA101',
            })),
        }]);

        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        const flightSelect = screen.getByLabelText('Replacement flight for MA100');
        expect(within(flightSelect).getByRole('option', {
            name: 'Mona Airways MA101 — Aug 21, 2026 at 09:00 PDT',
        })).toHaveValue('101');
        expect(within(flightSelect).getByRole('option', {
            name: 'Mona Airways MA101 — Aug 22, 2026 at 09:00 PDT',
        })).toHaveValue('102');
    });

    it('offers only the held cabin and disables occupied seats', async () => {
        mockGetOccupiedSeats.mockResolvedValue(['2A']);
        renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        const dialog = screen.getByRole('dialog');
        fireEvent.change(within(dialog).getAllByLabelText(/Replacement flight for/)[0], { target: { value: '101' } });

        const economy = await within(dialog).findByLabelText('Replacement seat for Ada Lovelace on MA101');
        const business = within(dialog).getByLabelText('Replacement seat for Grace Hopper on MA101');
        expect(within(economy).getByRole('option', { name: '2A — occupied' })).toBeDisabled();
        expect(within(economy).queryByRole('option', { name: '1A' })).not.toBeInTheDocument();
        expect(within(business).getByRole('option', { name: '1A' })).toBeInTheDocument();
        expect(within(business).queryByRole('option', { name: /2A/ })).not.toBeInTheDocument();

        const closeButton = within(dialog).getByRole('button', { name: 'Close replacement selection' });
        closeButton.focus();
        fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
        expect(within(dialog).getByRole('button', { name: 'Keep current booking' })).toHaveFocus();

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select replacement seats' })).toHaveFocus();
    });

    it('prevents two travellers choosing the same seat on one replacement flight', async () => {
        renderDialog(cancelledLegs.map(leg => ({
            ...leg,
            seatAssignments: leg.seatAssignments.map(assignment => ({
                ...assignment,
                cabinClass: 'ECONOMY',
            })),
        })));
        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        const dialog = screen.getByRole('dialog');
        fireEvent.change(within(dialog).getAllByLabelText(/Replacement flight for/)[0], { target: { value: '101' } });
        const ada = await within(dialog).findByLabelText('Replacement seat for Ada Lovelace on MA101');
        const grace = within(dialog).getByLabelText('Replacement seat for Grace Hopper on MA101');
        fireEvent.change(ada, { target: { value: '2B' } });

        expect(within(grace).getByRole('option', { name: '2B' })).toBeDisabled();
    });

    it('preserves selections and focuses recoverable server feedback', async () => {
        mockRebook.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'A selected replacement seat is no longer available.',
                fields: { _root: ['A selected replacement seat is no longer available.'] },
            },
        });
        renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        const dialog = screen.getByRole('dialog');
        const flightSelects = within(dialog).getAllByLabelText(/Replacement flight for/);
        fireEvent.change(flightSelects[0], { target: { value: '101' } });
        fireEvent.change(flightSelects[1], { target: { value: '201' } });
        await waitFor(() => expect(mockGetOccupiedSeats).toHaveBeenCalledTimes(2));
        for (const [label, value] of [
            ['Replacement seat for Ada Lovelace on MA101', '2A'],
            ['Replacement seat for Grace Hopper on MA101', '1A'],
            ['Replacement seat for Ada Lovelace on MA201', '2B'],
            ['Replacement seat for Grace Hopper on MA201', '1B'],
        ]) fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm replacement flights' }));

        const alert = await within(dialog).findByRole('alert');
        expect(alert).toHaveTextContent('A selected replacement seat is no longer available.');
        expect(alert).toHaveFocus();
        expect(within(dialog).getByLabelText('Replacement seat for Ada Lovelace on MA101')).toHaveValue('2A');
        await waitFor(() => expect(mockGetOccupiedSeats).toHaveBeenCalledTimes(4));
    });

    it('focuses safe feedback when replacement seat availability cannot load', async () => {
        mockGetOccupiedSeats.mockRejectedValue(new Error('private availability failure'));
        renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        fireEvent.change(screen.getAllByLabelText(/Replacement flight for/)[0], {
            target: { value: '101' },
        });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Seat availability could not be refreshed. Please try again.');
        expect(alert).not.toHaveTextContent('private availability failure');
        expect(alert).toHaveFocus();
    });

    it('focuses safe feedback when the rebooking action fails unexpectedly', async () => {
        mockRebook.mockRejectedValue(new Error('private rebooking failure'));
        renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Select replacement seats' }));
        const dialog = screen.getByRole('dialog');
        const flightSelects = within(dialog).getAllByLabelText(/Replacement flight for/);
        fireEvent.change(flightSelects[0], { target: { value: '101' } });
        fireEvent.change(flightSelects[1], { target: { value: '201' } });
        await waitFor(() => expect(mockGetOccupiedSeats).toHaveBeenCalledTimes(2));
        for (const [label, value] of [
            ['Replacement seat for Ada Lovelace on MA101', '2A'],
            ['Replacement seat for Grace Hopper on MA101', '1A'],
            ['Replacement seat for Ada Lovelace on MA201', '2B'],
            ['Replacement seat for Grace Hopper on MA201', '1B'],
        ]) fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm replacement flights' }));

        const alert = await within(dialog).findByRole('alert');
        expect(alert).toHaveTextContent('Your booking could not be rebooked. Please try again.');
        expect(alert).not.toHaveTextContent('private rebooking failure');
        expect(alert).toHaveFocus();
    });
});
