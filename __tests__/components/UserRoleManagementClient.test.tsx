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

    it('renders user table with points balance and filters by search text (name or email)', () => {
        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        expect(screen.getByText('User Role Management')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();
        expect(screen.getByText('50,000 pts')).toBeInTheDocument();
        expect(screen.getByText('12,000 pts')).toBeInTheDocument();

        const searchInput = screen.getByTestId('user-management-search');
        fireEvent.change(searchInput, { target: { value: 'Alice' } });

        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: 'bob@example.com' } });
        expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });

    it('filters users by role and displays empty filter message when no users match', () => {
        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        const roleFilter = screen.getByTestId('user-management-role-filter');

        fireEvent.change(roleFilter, { target: { value: 'ADMIN' } });
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();

        fireEvent.change(roleFilter, { target: { value: 'USER' } });
        expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();

        fireEvent.change(roleFilter, { target: { value: 'SUPPORT' } });
        expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('No users match the current filters.')).toBeInTheDocument();

        fireEvent.change(roleFilter, { target: { value: 'ALL' } });
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });

    it('renders empty state when initialUsers is empty', () => {
        render(<UserRoleManagementClient initialUsers={[]} />);
        expect(screen.getByText('No users found.')).toBeInTheDocument();
    });

    it('prompts for reason and step-up code when changing role', async () => {
        (updateUserRoleAction as jest.Mock).mockResolvedValue({ success: true });

        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        const bobRoleSelect = screen.getByLabelText('Change role for bob@example.com');
        fireEvent.change(bobRoleSelect, { target: { value: 'SUPPORT' } });

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

    it('renders live projected balance preview when entering positive or negative points delta', () => {
        render(<UserRoleManagementClient initialUsers={mockUsers} />);

        const adjustButtons = screen.getAllByRole('button', { name: /adjust points/i });
        // Click Adjust Points for Bob (current balance: 12,000 pts)
        fireEvent.click(adjustButtons[1]);

        expect(screen.getByRole('dialog', { name: /adjust loyalty points/i })).toBeInTheDocument();
        expect(screen.queryByTestId('points-adjustment-projected-balance')).not.toBeInTheDocument();

        const amountInput = screen.getByLabelText(/points delta/i);

        // Positive delta: +5000 -> 17,000 pts
        fireEvent.change(amountInput, { target: { value: '+5000' } });
        const preview = screen.getByTestId('points-adjustment-projected-balance');
        expect(preview).toBeInTheDocument();
        expect(preview).toHaveTextContent('Projected balance: 17,000 pts');
        expect(preview).not.toHaveTextContent('(Warning: resulting balance is negative)');

        // Negative delta exceeding balance: -15000 -> -3,000 pts with warning
        fireEvent.change(amountInput, { target: { value: '-15000' } });
        expect(screen.getByTestId('points-adjustment-projected-balance')).toHaveTextContent(
            'Projected balance: -3,000 pts (Warning: resulting balance is negative)'
        );

        // Invalid or zero delta hides preview
        fireEvent.change(amountInput, { target: { value: '0' } });
        expect(screen.queryByTestId('points-adjustment-projected-balance')).not.toBeInTheDocument();
    });
});


