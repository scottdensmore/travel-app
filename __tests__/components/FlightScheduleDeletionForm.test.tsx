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

    it('provides accessible text contrast for the delete action in both disabled and enabled states', () => {
        const contrastRatio = (foreground: string, background: string) => {
            const luminance = (hex: string) => {
                const channels = hex.match(/[a-f\d]{2}/gi)!.map(channel => parseInt(channel, 16) / 255);
                const [red, green, blue] = channels.map(channel =>
                    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
                );
                return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
            };
            const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
            return (values[0] + 0.05) / (values[1] + 0.05);
        };

        // WCAG AA requirement is >= 4.5:1
        expect(contrastRatio('#d4d4d8', '#2b2938')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#ffffff', '#dc2626')).toBeGreaterThanOrEqual(4.5);

        render(<FlightScheduleDeletionForm flightScheduleId={17} occurrenceCount={5} protectedOccurrenceCount={2} />);
        const button = screen.getByRole('button', { name: 'Delete template permanently' });

        // Disabled state: clear, readable disabled styling without failing contrast
        expect(button).toHaveStyle({
            backgroundColor: '#2b2938',
            color: '#d4d4d8',
            cursor: 'not-allowed',
        });

        // Enabled state: solid destructive background with high-contrast text
        fireEvent.click(screen.getByRole('checkbox'));
        expect(button).toHaveStyle({
            backgroundColor: '#dc2626',
            color: '#ffffff',
            cursor: 'pointer',
        });
    });
});

