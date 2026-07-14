import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { signOut } from 'next-auth/react';
import StaffMfaEnrollment from '@/app/staff/mfa/StaffMfaEnrollment';
import {
    beginStaffMfaEnrollment,
    confirmStaffMfaEnrollment,
} from '@/app/staff/mfa/actions';

jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));
jest.mock('@/app/staff/mfa/actions', () => ({
    beginStaffMfaEnrollment: jest.fn(),
    confirmStaffMfaEnrollment: jest.fn(),
}));

describe('StaffMfaEnrollment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (beginStaffMfaEnrollment as jest.Mock).mockResolvedValue({
            manualKey: 'JBSWY3DPEHPK3PXP',
            otpAuthUri: 'otpauth://totp/Mona',
        });
        (confirmStaffMfaEnrollment as jest.Mock).mockResolvedValue({ ok: true });
    });

    it('guides a staff member through setup and signs out the limited session', async () => {
        render(<StaffMfaEnrollment />);

        fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator' }));
        expect(await screen.findByTestId('staff-mfa-manual-key')).toHaveTextContent(
            'JBSWY3DPEHPK3PXP'
        );
        expect(screen.getByRole('link', { name: 'Open in authenticator app' }))
            .toHaveAttribute('href', 'otpauth://totp/Mona');

        fireEvent.change(screen.getByLabelText('Six-digit security code'), {
            target: { value: '12a3456' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Verify and finish setup' }));

        await waitFor(() => expect(confirmStaffMfaEnrollment).toHaveBeenCalledWith('123456'));
        expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login?staffMfa=enrolled' });
    });

    it('keeps setup disabled while the server action is pending', async () => {
        let resolveSetup!: (value: { manualKey: string; otpAuthUri: string }) => void;
        (beginStaffMfaEnrollment as jest.Mock).mockReturnValue(new Promise(resolve => {
            resolveSetup = resolve;
        }));
        render(<StaffMfaEnrollment />);

        fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Starting setup…' })).toBeDisabled();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Starting setup…' }));
        expect(beginStaffMfaEnrollment).toHaveBeenCalledTimes(1);

        resolveSetup({
            manualKey: 'JBSWY3DPEHPK3PXP',
            otpAuthUri: 'otpauth://totp/Mona',
        });
        expect(await screen.findByTestId('staff-mfa-manual-key')).toBeInTheDocument();
    });

    it('keeps the setup visible and announces an invalid code', async () => {
        (confirmStaffMfaEnrollment as jest.Mock).mockResolvedValue({
            ok: false,
            error: 'That code is invalid or expired.',
        });
        render(<StaffMfaEnrollment />);
        fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator' }));
        await screen.findByTestId('staff-mfa-manual-key');

        fireEvent.change(screen.getByLabelText('Six-digit security code'), {
            target: { value: '123456' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Verify and finish setup' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('That code is invalid or expired.');
        expect(signOut).not.toHaveBeenCalled();
    });
});
