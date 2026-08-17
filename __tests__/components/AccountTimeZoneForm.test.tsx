import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AccountTimeZoneForm from '@/components/ui/AccountTimeZoneForm';
import { updateAccountTimeZoneAction } from '@/app/actions';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
}));

jest.mock('@/app/actions', () => ({
    updateAccountTimeZoneAction: jest.fn(),
}));

const mockedUpdate = updateAccountTimeZoneAction as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;

describe('AccountTimeZoneForm', () => {
    const refresh = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseRouter.mockReturnValue({ refresh });
    });

    it('saves the chosen timezone and announces the labelled account-time change', async () => {
        mockedUpdate.mockResolvedValue({ timeZone: 'America/Los_Angeles' });
        render(
            <AccountTimeZoneForm
                timeZone="UTC"
                choices={['UTC', 'America/Los_Angeles']}
            />,
        );
        expect(screen.getByText(
            'Payment receipts and points activity use this saved timezone, not this browser\'s location.',
        )).toBeInTheDocument();
        expect(screen.queryByText(/Booking and payment times/)).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', { name: 'Account timezone' }), {
            target: { value: 'America/Los_Angeles' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save timezone' }));

        await waitFor(() => {
            expect(mockedUpdate).toHaveBeenCalledWith('America/Los_Angeles');
            expect(refresh).toHaveBeenCalledTimes(1);
        });
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent(
            'Payment receipts and points activity now use America/Los_Angeles.',
        );
        expect(status).toHaveFocus();
    });

    it('prevents duplicate saves while the first request is pending', async () => {
        let resolve!: (value: { timeZone: string }) => void;
        mockedUpdate.mockImplementation(() => new Promise(done => { resolve = done; }));
        render(
            <AccountTimeZoneForm
                timeZone="UTC"
                choices={['UTC', 'America/Los_Angeles']}
            />,
        );

        const save = screen.getByRole('button', { name: 'Save timezone' });
        const form = screen.getByRole('form', { name: 'Account timezone settings' });
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(mockedUpdate).toHaveBeenCalledTimes(1);
        expect(save).not.toBeDisabled();
        expect(save).toHaveAttribute('aria-disabled', 'true');
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(save).toHaveTextContent('Saving timezone…');
        resolve({ timeZone: 'UTC' });
        await screen.findByRole('status');
    });

    it('shows safe validation and unexpected-error feedback at the form', async () => {
        mockedUpdate
            .mockResolvedValueOnce({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Choose a recognized IANA timezone.',
                    fields: { _root: ['Choose a recognized IANA timezone.'] },
                },
            })
            .mockRejectedValueOnce(new Error('database-password-sentinel'));
        render(
            <AccountTimeZoneForm
                timeZone="UTC"
                choices={['UTC', 'America/Los_Angeles']}
            />,
        );

        const save = screen.getByRole('button', { name: 'Save timezone' });
        fireEvent.click(save);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Choose a recognized IANA timezone.',
        );

        fireEvent.click(save);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Could not update your timezone. Please try again.');
        expect(alert).not.toHaveTextContent('database-password-sentinel');
        expect(alert).toHaveFocus();
    });
});
