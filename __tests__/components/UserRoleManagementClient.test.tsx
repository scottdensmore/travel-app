import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserRoleManagementClient from '@/components/admin/UserRoleManagementClient';
import { updateUserRoleAction, adjustUserPointsAction } from '@/app/actions/userRoleActions';

jest.mock('@/app/actions/userRoleActions', () => ({
    updateUserRoleAction: jest.fn(),
    adjustUserPointsAction: jest.fn(),
}));

const mockUsers = [
    {
        id: 'u1',
        name: 'Alice Admin',
        email: 'alice@example.com',
        role: 'ADMIN',
        spendablePoints: 50000,
        createdAt: new Date().toISOString(),
    },
    {
        id: 'u2',
        name: 'Bob Traveler',
        email: 'bob@example.com',
        role: 'USER',
        spendablePoints: 12000,
        createdAt: new Date().toISOString(),
    },
];

describe('UserRoleManagementClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders user table with points balance and filters by search text', () => {
        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        expect(screen.getByText('User Role Management')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();
        expect(screen.getByText('50,000 pts')).toBeInTheDocument();
        expect(screen.getByText('12,000 pts')).toBeInTheDocument();

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

    it('opens Adjust Points modal, validates delta and reason, and submits step-up adjustment', async () => {
        (adjustUserPointsAction as jest.Mock).mockResolvedValue({
            success: true,
            balanceAfter: 17000,
        });

        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        const adjustButtons = screen.getAllByRole('button', { name: /adjust points/i });
        // Click Adjust Points for Bob (index 1)
        fireEvent.click(adjustButtons[1]);

        expect(screen.getByRole('dialog', { name: /adjust loyalty points/i })).toBeInTheDocument();

        const amountInput = screen.getByLabelText(/points delta/i);
        const reasonInput = screen.getByLabelText(/adjustment reason/i);

        fireEvent.change(amountInput, { target: { value: '+5000' } });
        fireEvent.change(reasonInput, { target: { value: 'Goodwill credit for flight delay' } });

        const continueBtn = screen.getByRole('button', { name: /continue to authorization/i });
        fireEvent.click(continueBtn);

        // StepUpModal appears
        expect(screen.getByRole('dialog', { name: /authorize points adjustment/i })).toBeInTheDocument();
        const codeInput = screen.getByLabelText(/security code/i);
        fireEvent.change(codeInput, { target: { value: '123456' } });

        const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(adjustUserPointsAction).toHaveBeenCalledWith({
                userId: 'u2',
                amount: 5000,
                reason: 'Goodwill credit for flight delay',
                stepUpCode: '123456',
            });
        });

        expect(await screen.findByText(/successfully adjusted points for bob@example\.com/i)).toBeInTheDocument();
        expect(screen.getByText('17,000 pts')).toBeInTheDocument();
    });
});

