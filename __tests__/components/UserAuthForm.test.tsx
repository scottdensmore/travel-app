import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserAuthForm from '@/app/login/components/user-auth-form';
import { getSession, signIn } from 'next-auth/react';

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock('next-auth/react', () => ({ getSession: jest.fn(), signIn: jest.fn() }));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, refresh: mockRefresh })
}));

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

describe('UserAuthForm registration errors', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        global.fetch = jest.fn();
        (getSession as jest.Mock).mockResolvedValue({ user: { role: 'USER' } });
    });

    it('keeps accepted and pending status text above WCAG AA contrast', () => {
        expect(contrastRatio('#86efac', '#0d0c14')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#d4d4d8', '#0d0c14')).toBeGreaterThanOrEqual(4.5);
    });

    it('shows structured server validation errors and associates them with fields', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            json: async () => ({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Enter a valid email address.',
                    fields: { email: ['Enter a valid email address.'] }
                }
            })
        } as Response);
        render(<UserAuthForm type="signup" />);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Enter a valid email address.');
        await waitFor(() => {
            expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
            expect(screen.getByLabelText('Email')).toHaveAttribute(
                'aria-describedby',
                'registration-email-error'
            );
            expect(screen.getByLabelText('Email')).toHaveFocus();
        });
    });

    it('shows a generic login failure without exposing account existence', async () => {
        (signIn as jest.Mock).mockResolvedValue({ error: 'CredentialsSignin' });
        render(<UserAuthForm type="login" />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unknown@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In with Email' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Invalid email or password.');
        await waitFor(() => expect(alert).toHaveFocus());
    });

    it('routes regular users to the home page after login', async () => {
        (signIn as jest.Mock).mockResolvedValue({ ok: true });
        render(<UserAuthForm type="login" />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In with Email' }));

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('continues first-time staff through the enrollment gate', async () => {
        (signIn as jest.Mock).mockResolvedValue({ ok: true });
        (getSession as jest.Mock).mockResolvedValue({
            user: { role: 'ADMIN', staffMfaVerified: false, staffMfaEnrollmentRequired: true },
        });
        render(<UserAuthForm type="login" />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In with Email' }));

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/staff/mfa'));
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('submits the optional staff code and routes verified staff to admin', async () => {
        (signIn as jest.Mock).mockResolvedValue({ ok: true });
        (getSession as jest.Mock).mockResolvedValue({
            user: { role: 'ADMIN', staffMfaVerified: true, staffMfaEnrollmentRequired: false },
        });
        render(<UserAuthForm type="login" />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText(/Staff security code/), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In with Email' }));

        await waitFor(() => expect(signIn).toHaveBeenCalledWith('credentials', {
            redirect: false,
            email: 'admin@example.com',
            password: 'password123',
            staffCode: '123456',
        }));
        expect(mockPush).toHaveBeenCalledWith('/admin');
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('shows the same neutral state after every accepted registration without signing in', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                message: 'If this address can be registered, the request has been accepted.'
            })
        } as Response);
        render(<UserAuthForm type="signup" />);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'If this address is eligible, check your email for a verification link.'
        );
        expect(screen.getByRole('status')).toHaveStyle({ color: '#86efac' });
        expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
        expect(signIn).not.toHaveBeenCalled();
    });

    it('recovers from a rejected login request with a focusable generic error', async () => {
        (signIn as jest.Mock).mockRejectedValue(new Error('network unavailable'));
        render(<UserAuthForm type="login" />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In with Email' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Unable to sign in right now. Please try again.');
        expect(alert).toHaveStyle({ outline: '2px solid #f87171', outlineOffset: '2px' });
        expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
        expect(screen.getByRole('button', { name: 'Sign In with Email' })).toBeEnabled();
        await waitFor(() => expect(alert).toHaveFocus());
    });

    it('announces and visibly disables the pending login state', async () => {
        let resolveSignIn!: (value: { error: string }) => void;
        (signIn as jest.Mock).mockImplementation(() => new Promise(resolve => {
            resolveSignIn = resolve;
        }));
        render(<UserAuthForm type="login" />);
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In with Email' }));

        const pendingButton = screen.getByRole('button', { name: 'Signing in…' });
        expect(pendingButton).toBeDisabled();
        expect(pendingButton).toHaveAttribute('aria-busy', 'true');
        expect(pendingButton).toHaveStyle({ opacity: '0.65', cursor: 'not-allowed' });
        expect(screen.getByRole('status')).toHaveTextContent('Signing in…');
        expect(screen.getByRole('status')).toHaveStyle({ color: '#d4d4d8' });

        resolveSignIn({ error: 'CredentialsSignin' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In with Email' })).toBeEnabled());
    });
});
