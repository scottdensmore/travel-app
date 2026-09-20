import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PrivacySettingsClient from '@/components/profile/PrivacySettingsClient';
import { deleteAccountAction } from '@/app/actions';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: mockPush,
        refresh: mockRefresh,
    }),
}));

jest.mock('next-auth/react', () => ({
    signOut: jest.fn(),
}));

jest.mock('@/app/actions', () => ({
    deleteAccountAction: jest.fn(),
}));

describe('PrivacySettingsClient Component', () => {
    const defaultProps = {
        userId: 'usr-100',
        userEmail: 'user@example.com',
        userName: 'Alex Traveler',
        initialEligibility: {
            eligible: true,
            reason: null,
            message: null,
            upcomingBookingsCount: 0,
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders privacy headers, export section, and deletion section', () => {
        render(<PrivacySettingsClient {...defaultProps} />);

        expect(screen.getByText('Privacy & Data Protection')).toBeInTheDocument();
        expect(screen.getByText('Download My Data')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Delete My Account' })).toBeInTheDocument();
        expect(screen.getByText('Download My Data (JSON)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete My Account' })).toBeEnabled();
    });

    it('displays pre-flight warning and disables deletion when active flights exist', () => {
        const blockedProps = {
            ...defaultProps,
            initialEligibility: {
                eligible: false,
                reason: 'UPCOMING_FLIGHTS' as const,
                message: 'Account deletion cannot proceed because you have 2 upcoming active bookings.',
                upcomingBookingsCount: 2,
            },
        };

        render(<PrivacySettingsClient {...blockedProps} />);

        expect(screen.getByText('Deletion Currently Blocked')).toBeInTheDocument();
        expect(
            screen.getByText(/Account deletion cannot proceed because you have 2 upcoming active bookings/)
        ).toBeInTheDocument();
        const deleteButton = screen.getByRole('button', { name: 'Delete My Account' });
        expect(deleteButton).toBeDisabled();
    });

    it('opens confirmation modal and allows cancellation', async () => {
        render(<PrivacySettingsClient {...defaultProps} />);

        const deleteButton = screen.getByRole('button', { name: 'Delete My Account' });
        fireEvent.click(deleteButton);

        expect(screen.getByRole('heading', { name: 'Confirm Account Deletion' })).toBeInTheDocument();
        expect(screen.getByLabelText(/enter your password to confirm/i)).toBeInTheDocument();

        // Cancel closes the modal
        const cancelButton = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelButton);

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Confirm Account Deletion' })).not.toBeInTheDocument();
        });
    });

    it('displays error if deletion fails with incorrect password', async () => {
        (deleteAccountAction as jest.Mock).mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'The password you entered is incorrect.',
                fields: { password: ['The password you entered is incorrect.'] },
            },
        });

        render(<PrivacySettingsClient {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete My Account' }));

        const passwordInput = screen.getByLabelText(/enter your password to confirm/i);
        fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });

        const confirmButton = screen.getByRole('button', { name: 'Permanently Delete Account' });
        fireEvent.click(confirmButton);

        await waitFor(() => {
            expect(screen.getByText('The password you entered is incorrect.')).toBeInTheDocument();
        });
        expect(signOut).not.toHaveBeenCalled();
    });

    it('terminates sessions and redirects to landing page with banner on successful deletion', async () => {
        (deleteAccountAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { deleted: true },
        });
        (signOut as jest.Mock).mockResolvedValue(undefined);

        render(<PrivacySettingsClient {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete My Account' }));

        const passwordInput = screen.getByLabelText(/enter your password to confirm/i);
        fireEvent.change(passwordInput, { target: { value: 'validpassword' } });

        const confirmButton = screen.getByRole('button', { name: 'Permanently Delete Account' });
        fireEvent.click(confirmButton);

        await waitFor(() => {
            expect(deleteAccountAction).toHaveBeenCalledWith('validpassword');
            expect(signOut).toHaveBeenCalledWith({ redirect: false });
            expect(mockPush).toHaveBeenCalledWith('/?accountDeleted=true');
        });
    });

    it('triggers file download when Download My Data button is clicked', async () => {
        const createObjectURLMock = jest.fn().mockReturnValue('blob:http://localhost/blob123');
        const revokeObjectURLMock = jest.fn();
        window.URL.createObjectURL = createObjectURLMock;
        window.URL.revokeObjectURL = revokeObjectURLMock;

        // Mock HTMLAnchorElement click to avoid JSDOM navigation
        const originalCreateElement = document.createElement.bind(document);
        const anchorClickMock = jest.fn();
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const el = originalCreateElement(tagName);
            if (tagName.toLowerCase() === 'a') {
                el.click = anchorClickMock;
            }
            return el;
        });

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            blob: jest.fn().mockResolvedValue(new Blob(['{}'], { type: 'application/json' })),
        } as any);

        render(<PrivacySettingsClient {...defaultProps} />);

        const downloadButton = screen.getByRole('button', { name: 'Download My Data (JSON)' });
        fireEvent.click(downloadButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/privacy/export');
            expect(createObjectURLMock).toHaveBeenCalled();
            expect(anchorClickMock).toHaveBeenCalled();
            expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/blob123');
        });

        (document.createElement as jest.Mock).mockRestore();
    });
});
