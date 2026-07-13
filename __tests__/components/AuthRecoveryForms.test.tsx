import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthEmailRequestForm from '@/components/auth/AuthEmailRequestForm';
import AuthTokenPage from '@/components/auth/AuthTokenPage';
import { PasswordResetForm, VerifyEmailForm } from '@/components/auth/AuthTokenForms';

describe('authentication recovery forms', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        global.fetch = jest.fn();
        window.history.replaceState(null, '', '/');
    });

    it('reads a valid bearer token from the fragment and immediately strips it from browser history', async () => {
        const token = 'a'.repeat(43);
        window.location.hash = `token=${token}`;
        const replaceState = jest.spyOn(window.history, 'replaceState');

        render(<AuthTokenPage mode="verify" />);

        expect(await screen.findByRole('button', { name: 'Verify email' })).toBeVisible();
        expect(replaceState).toHaveBeenCalledWith(null, '', '/');
        expect(window.location.hash).toBe('');
    });

    it('rejects a malformed fragment without rendering an action form', async () => {
        window.location.hash = 'token=x';

        render(<AuthTokenPage mode="reset" />);

        expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
        expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
    });

    it('shows the same generic result for a verification resend request', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ message: 'If the account is eligible, an email will be sent shortly.' })
        });
        render(<AuthEmailRequestForm mode="verification" />);

        fireEvent.change(screen.getByLabelText('Email address'), {
            target: { value: 'Ada@Example.com' }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }));

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
            'If the account is eligible, an email will be sent shortly.'
        ));
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/verification/request', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ email: 'Ada@Example.com' }),
        }));
    });

    it('recovers from a network failure and re-enables password recovery', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
        render(<AuthEmailRequestForm mode="password" />);

        fireEvent.change(screen.getByLabelText('Email address'), {
            target: { value: 'ada@example.com' }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send password reset email' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Unable to submit this request right now. Please try again.'
        );
        expect(screen.getByRole('button', { name: 'Send password reset email' })).toBeEnabled();
    });

    it('does not consume a verification token until the customer confirms', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ message: 'Your email has been verified.' })
        });
        render(<VerifyEmailForm token={'a'.repeat(43)} />);

        expect(global.fetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your email has been verified.'));
        expect(screen.queryByRole('link', { name: 'Continue to sign in' })).not.toBeInTheDocument();
    });

    it('announces verification progress and disables repeat confirmation', async () => {
        let resolveRequest!: (value: unknown) => void;
        (global.fetch as jest.Mock).mockReturnValue(new Promise(resolve => {
            resolveRequest = resolve;
        }));
        render(<VerifyEmailForm token={'a'.repeat(43)} />);

        fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

        expect(screen.getByRole('status')).toHaveTextContent('Verifying email…');
        expect(screen.getByRole('button', { name: 'Verifying email…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Verifying email…' })).toHaveAttribute('aria-busy', 'true');

        resolveRequest({ ok: false, json: async () => ({ error: { message: 'Link expired.' } }) });
        expect(await screen.findByRole('alert')).toHaveTextContent('Link expired.');
        expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    });

    it('validates matching passwords before submitting a reset token', async () => {
        render(<PasswordResetForm token={'b'.repeat(43)} />);

        fireEvent.change(screen.getByLabelText('New password'), {
            target: { value: 'NewPassword123!' }
        });
        fireEvent.change(screen.getByLabelText('Confirm new password'), {
            target: { value: 'DifferentPassword123!' }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Passwords must match.');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('submits a valid password reset and offers sign in', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ message: 'Your password has been reset.' })
        });
        render(<PasswordResetForm token={'b'.repeat(43)} />);

        fireEvent.change(screen.getByLabelText('New password'), {
            target: { value: 'NewPassword123!' }
        });
        fireEvent.change(screen.getByLabelText('Confirm new password'), {
            target: { value: 'NewPassword123!' }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/password/reset', expect.objectContaining({
            body: JSON.stringify({ token: 'b'.repeat(43), password: 'NewPassword123!' })
        }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your password has been reset.'));
        expect(screen.queryByRole('link', { name: 'Continue to sign in' })).not.toBeInTheDocument();
    });
});
