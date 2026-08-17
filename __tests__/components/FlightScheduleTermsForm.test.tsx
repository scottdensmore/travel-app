import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { updateFlightScheduleTermsAction } from '@/app/actions';
import FlightScheduleTermsForm from '@/components/ui/FlightScheduleTermsForm';

jest.mock('@/app/actions', () => ({
    updateFlightScheduleTermsAction: jest.fn(),
}));

const refresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh }),
}));

const updateTerms = updateFlightScheduleTermsAction as jest.Mock;

describe('FlightScheduleTermsForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('prefills the current terms and names the previewed impact', () => {
        renderForm();

        expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(245);
        expect(screen.getByLabelText('Fare ($)')).toHaveValue('$350');
        expect(screen.getByText(/1 safe future occurrence will receive the new values/i))
            .toBeInTheDocument();
        expect(screen.getByText(/4 protected occurrences will remain unchanged/i))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Update duration and fare' })).toBeDisabled();
    });

    it('requires explicit review confirmation and announces the durable result', async () => {
        let resolve!: (value: unknown) => void;
        updateTerms.mockReturnValue(new Promise(value => { resolve = value; }));
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '255' } });
        fireEvent.change(screen.getByLabelText('Fare ($)'), { target: { value: '375' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the impact/i }));
        const submit = screen.getByRole('button', { name: 'Update duration and fare' });
        submit.focus();
        fireEvent.click(submit);

        expect(updateTerms).toHaveBeenCalledWith({
            requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
            flightScheduleId: 17,
            durationMinutes: 255,
            price: '$375',
            confirmed: true,
        });
        const pending = screen.getByRole('button', { name: 'Updating schedule...' });
        expect(pending).toHaveAttribute('aria-busy', 'true');
        expect(pending).toHaveAttribute('aria-disabled', 'true');
        expect(pending).not.toBeDisabled();
        expect(pending).toHaveFocus();
        fireEvent.click(pending);
        expect(updateTerms).toHaveBeenCalledTimes(1);

        await act(async () => resolve({
            changeId: 'change-17',
            flightScheduleId: 17,
            durationMinutes: 255,
            priceCents: 37_500,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 4,
            createdAt: new Date('2026-08-17T15:00:00.000Z'),
            wasApplied: true,
        }));

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent(
            'Updated the template and 1 safe future occurrence. 4 protected occurrences were unchanged. Audit change-17.',
        );
        await waitFor(() => expect(status).toHaveFocus());
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('checkbox', { name: /reviewed the impact/i })).not.toBeChecked();
    });

    it('uses the same request key to recover an unconfirmed response without leaking the error', async () => {
        updateTerms
            .mockRejectedValueOnce(new Error('postgresql://secret-host/internal'))
            .mockResolvedValueOnce({
                changeId: 'change-17',
                flightScheduleId: 17,
                durationMinutes: 255,
                priceCents: 37_500,
                updatedOccurrenceCount: 1,
                protectedOccurrenceCount: 4,
                createdAt: new Date('2026-08-17T15:00:00.000Z'),
                wasApplied: false,
            });
        renderForm();
        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '255' } });
        fireEvent.change(screen.getByLabelText('Fare ($)'), { target: { value: '375' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the impact/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'We could not confirm the update. Retry to safely recover the same request.',
        );
        expect(alert).not.toHaveTextContent('secret-host');
        const firstRequestId = updateTerms.mock.calls[0][0].requestId;

        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));
        await screen.findByText(/Recovered the audited update/i);
        expect(updateTerms.mock.calls[1][0].requestId).toBe(firstRequestId);
    });

    it('focuses safe validation feedback', async () => {
        updateTerms.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Change the duration or fare before updating this schedule.',
                fields: { _root: ['Change the duration or fare before updating this schedule.'] },
            },
        });
        renderForm();
        fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the impact/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));

        const alert = await screen.findByRole('alert');
        await waitFor(() => expect(alert).toHaveFocus());
    });

    it('replaces a request key rejected as belonging to another update', async () => {
        updateTerms
            .mockResolvedValueOnce({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'This retry key belongs to a different schedule update. Start a new update.',
                    fields: { requestId: ['This retry key belongs to a different schedule update. Start a new update.'] },
                },
            })
            .mockResolvedValueOnce({
                changeId: 'change-17',
                flightScheduleId: 17,
                durationMinutes: 255,
                priceCents: 37_500,
                updatedOccurrenceCount: 1,
                protectedOccurrenceCount: 4,
                createdAt: new Date('2026-08-17T15:00:00.000Z'),
                wasApplied: true,
            });
        renderForm();
        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '255' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the impact/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));

        await screen.findByRole('alert');
        const rejectedRequestId = updateTerms.mock.calls[0][0].requestId;
        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));
        await waitFor(() => expect(updateTerms).toHaveBeenCalledTimes(2));
        expect(updateTerms.mock.calls[1][0].requestId).not.toBe(rejectedRequestId);
    });

    it('mints a new request key after a confirmed success', async () => {
        updateTerms.mockResolvedValue({
            changeId: 'change-17',
            flightScheduleId: 17,
            durationMinutes: 255,
            priceCents: 37_500,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 4,
            createdAt: new Date('2026-08-17T15:00:00.000Z'),
            wasApplied: true,
        });
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '255' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the impact/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));
        await screen.findByRole('status');
        const firstRequestId = updateTerms.mock.calls[0][0].requestId;

        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '260' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the impact/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Update duration and fare' }));
        await waitFor(() => expect(updateTerms).toHaveBeenCalledTimes(2));
        expect(updateTerms.mock.calls[1][0].requestId).not.toBe(firstRequestId);
    });
});

function renderForm() {
    return render(
        <FlightScheduleTermsForm
            flightScheduleId={17}
            durationMinutes={245}
            priceCents={35_000}
            safeFutureCount={1}
            protectedCount={4}
        />,
    );
}
