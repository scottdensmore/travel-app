import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FlightScheduleDeletionForm from '@/components/ui/FlightScheduleDeletionForm';
import { deleteFlightScheduleAction } from '@/app/actions';

jest.mock('@/app/actions', () => ({ deleteFlightScheduleAction: jest.fn() }));

const deleteSchedule = deleteFlightScheduleAction as jest.Mock;

describe('FlightScheduleDeletionForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: { randomUUID: () => '8ea59a65-9251-45b3-95d0-3920c49f5735' },
        });
    });

    it('states the irreversible boundary and requires confirmation', () => {
        render(<FlightScheduleDeletionForm flightScheduleId={17} occurrenceCount={5} protectedOccurrenceCount={2} />);

        expect(screen.getByText(/all 5 linked occurrences and their bookings remain unchanged/i)).toBeInTheDocument();
        expect(screen.getByText(/2 protected occurrences/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete template permanently' })).toBeDisabled();
    });

    it('uses one retry key only after deletion is confirmed', async () => {
        deleteSchedule.mockResolvedValue(undefined);
        render(<FlightScheduleDeletionForm flightScheduleId={17} occurrenceCount={5} protectedOccurrenceCount={2} />);

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete template permanently' }));

        await waitFor(() => expect(deleteSchedule).toHaveBeenCalledWith({
            requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            flightScheduleId: 17,
            confirmed: true,
        }));
    });

    it('keeps the pending control focused and ignores a duplicate activation', async () => {
        let finish!: () => void;
        deleteSchedule.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
        render(<FlightScheduleDeletionForm flightScheduleId={17} occurrenceCount={5} protectedOccurrenceCount={2} />);

        fireEvent.click(screen.getByRole('checkbox'));
        const button = screen.getByRole('button', { name: 'Delete template permanently' });
        button.focus();
        fireEvent.click(button);

        const pendingButton = screen.getByRole('button', { name: 'Deleting template...' });
        expect(pendingButton).toHaveFocus();
        expect(pendingButton).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(pendingButton);
        expect(deleteSchedule).toHaveBeenCalledTimes(1);

        finish();
        await waitFor(() => expect(pendingButton).toHaveAttribute('aria-busy', 'false'));
    });

    it.each([
        [{
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Deactivate this template before deleting it permanently.',
                fields: { _root: ['Deactivate this template before deleting it permanently.'] },
            },
        }, 'Deactivate this template before deleting it permanently.'],
        [new Error('private database detail'), 'We could not confirm the deletion. Retry with the same safe request.'],
    ])('focuses safe feedback without navigating when deletion fails', async (failure, message) => {
        if (failure instanceof Error) deleteSchedule.mockRejectedValue(failure);
        else deleteSchedule.mockResolvedValue(failure);
        render(<FlightScheduleDeletionForm flightScheduleId={17} occurrenceCount={5} protectedOccurrenceCount={2} />);

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete template permanently' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(message);
        await waitFor(() => expect(alert).toHaveFocus());
        expect(alert).not.toHaveTextContent('private database detail');
    });
});
