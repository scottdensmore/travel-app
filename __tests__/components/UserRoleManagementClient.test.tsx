import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserRoleManagementClient from '@/components/admin/UserRoleManagementClient';
import { updateUserRoleAction } from '@/app/actions/userRoleActions';

jest.mock('@/app/actions/userRoleActions', () => ({
    updateUserRoleAction: jest.fn(),
}));

const mockUsers = [
    {
        id: 'u1',
        name: 'Alice Admin',
        email: 'alice@example.com',
        role: 'ADMIN',
        createdAt: new Date().toISOString(),
    },
    {
        id: 'u2',
        name: 'Bob Traveler',
        email: 'bob@example.com',
        role: 'USER',
        createdAt: new Date().toISOString(),
    },
];

describe('UserRoleManagementClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders user table and filters by search text', () => {
        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        expect(screen.getByText('User Role Management')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();

        const searchInput = screen.getByPlaceholderText(/search users/i);
        fireEvent.change(searchInput, { target: { value: 'alice' } });

        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    });

    it('prompts for reason and step-up code when changing role', async () => {
        (updateUserRoleAction as jest.Mock).mockResolvedValue({ success: true });

        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        const roleSelects = screen.getAllByRole('combobox');
        // Bob is index 1
        fireEvent.change(roleSelects[1], { target: { value: 'SUPPORT' } });

        // Reason dialog appears
        expect(screen.getByText(/reason for role change/i)).toBeInTheDocument();
        const reasonInput = screen.getByLabelText(/justification reason/i);
        fireEvent.change(reasonInput, { target: { value: 'Promoted to support tier 1' } });

        const continueBtn = screen.getByRole('button', { name: /continue to authorization/i });
        fireEvent.click(continueBtn);

        // StepUpModal appears
        expect(screen.getByRole('dialog', { name: /authorize role change/i })).toBeInTheDocument();
        const codeInput = screen.getByLabelText(/security code/i);
        fireEvent.change(codeInput, { target: { value: '654321' } });

        const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(updateUserRoleAction).toHaveBeenCalledWith({
                userId: 'u2',
                newRole: 'SUPPORT',
                reason: 'Promoted to support tier 1',
                stepUpCode: '654321',
            });
        });

        expect(await screen.findByText(/successfully updated role to support/i)).toBeInTheDocument();
    });
});
