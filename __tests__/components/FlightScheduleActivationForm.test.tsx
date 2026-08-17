/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightScheduleActivationForm from '@/components/ui/FlightScheduleActivationForm';
import { setFlightScheduleActiveAction } from '@/app/actions';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
jest.mock('@/app/actions', () => ({ setFlightScheduleActiveAction: jest.fn() }));

const setActive = setFlightScheduleActiveAction as jest.Mock;

describe('FlightScheduleActivationForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('explains that deactivation preserves existing inventory and requires confirmation', () => {
        render(<FlightScheduleActivationForm flightScheduleId={17} isActive occurrenceCount={4} />);

        expect(screen.getByText(/stops automatic and manual generation/i)).toBeInTheDocument();
        expect(screen.getByText(/4 linked occurrences and all associated bookings stay unchanged/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Deactivate template' })).toBeDisabled();
    });

    it('deactivates to a recoverable, focused status without mutating occurrences', async () => {
        setActive.mockResolvedValue({
            flightScheduleId: 17,
            isActive: false,
            changed: true,
            // The server recounts under the activation lock; the preview can
            // be stale if an earlier generator finished after it rendered.
            preservedOccurrenceCount: 5,
        });
        render(<FlightScheduleActivationForm flightScheduleId={17} isActive occurrenceCount={4} />);

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate template' }));

        const status = await screen.findByRole('status');
        expect(setActive).toHaveBeenCalledWith(17, false);
        expect(status).toHaveTextContent('Template deactivated. 5 linked occurrences were preserved.');
        expect(status).toHaveClass('schedule-activation-feedback');
        expect(status).toHaveFocus();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('offers reversible reactivation and truthfully reports an idempotent retry', async () => {
        setActive.mockResolvedValue({
            flightScheduleId: 17,
            isActive: true,
            changed: false,
            preservedOccurrenceCount: 1,
        });
        render(<FlightScheduleActivationForm flightScheduleId={17} isActive={false} occurrenceCount={1} />);

        expect(screen.getByText(/resumes automatic and manual generation without changing the linked occurrences/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Reactivate template' }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Template was already active. 1 linked occurrence was preserved.',
        );
        expect(setActive).toHaveBeenCalledWith(17, true);
    });

    it('keeps a safe retry path when the response is lost', async () => {
        setActive.mockRejectedValue(new Error('private database sentinel'));
        render(<FlightScheduleActivationForm flightScheduleId={17} isActive occurrenceCount={4} />);

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate template' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('We could not confirm the change. Retry to safely request the same state.');
        expect(alert).not.toHaveTextContent('private database sentinel');
        expect(alert).toHaveClass('schedule-activation-feedback');
        await waitFor(() => expect(alert).toHaveFocus());
    });

    it('focuses the safe service refusal instead of treating it as success', async () => {
        setActive.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'This flight schedule no longer exists.',
                fields: { _root: ['This flight schedule no longer exists.'] },
            },
        });
        render(<FlightScheduleActivationForm flightScheduleId={17} isActive occurrenceCount={4} />);

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate template' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This flight schedule no longer exists.');
        expect(alert).toHaveClass('schedule-activation-feedback');
        expect(alert).toHaveFocus();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('retains submit focus while pending and ignores a duplicate activation', async () => {
        let resolve!: (value: unknown) => void;
        setActive.mockReturnValue(new Promise(resolver => { resolve = resolver; }));
        render(<FlightScheduleActivationForm flightScheduleId={17} isActive occurrenceCount={4} />);

        fireEvent.click(screen.getByRole('checkbox'));
        const submit = screen.getByRole('button', { name: 'Deactivate template' });
        submit.focus();
        fireEvent.click(submit);
        fireEvent.click(screen.getByRole('button', { name: 'Deactivating template...' }));

        expect(setActive).toHaveBeenCalledTimes(1);
        expect(submit).toHaveFocus();
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(submit).toHaveAttribute('aria-disabled', 'true');
        expect(submit).toBeEnabled();

        resolve({
            flightScheduleId: 17,
            isActive: false,
            changed: true,
            preservedOccurrenceCount: 4,
        });
        await screen.findByRole('status');
    });
});
