/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentRecoveryQueue from '@/components/ui/PaymentRecoveryQueue';
import { reconcilePaymentAttemptAction } from '@/app/actions';

jest.mock('@/app/actions', () => ({
    reconcilePaymentAttemptAction: jest.fn(),
}));

const mockedReconcile = reconcilePaymentAttemptAction as jest.Mock;
const attempt = {
    id: 'attempt-123',
    checkoutId: 'checkout-123',
    providerIntentId: 'pi_provider_123',
    amountCents: 72_500,
    currency: 'USD',
    status: 'PROCESSING' as const,
    updatedAt: '2026-08-15T10:00:00.000Z',
    userName: 'Ada Lovelace',
    userEmail: 'ada@example.com',
};

describe('PaymentRecoveryQueue', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders the operational details needed to identify a stale attempt', () => {
        render(<PaymentRecoveryQueue initialAttempts={[attempt]} />);

        const item = screen.getByRole('article', { name: 'Payment attempt attempt-123' });
        expect(item).toHaveTextContent('Ada Lovelace');
        expect(item).toHaveTextContent('ada@example.com');
        expect(item).toHaveTextContent('$725 USD');
        expect(item).toHaveTextContent('PROCESSING');
        expect(item).toHaveTextContent('pi_provider_123');
        expect(screen.getByRole('button', { name: 'Refresh payment status' })).toBeEnabled();
    });

    it('announces and focuses a changed terminal status without losing the result', async () => {
        mockedReconcile.mockResolvedValue({
            ok: true,
            attemptId: attempt.id,
            previousStatus: 'PROCESSING',
            status: 'CAPTURED',
            changed: true,
            updatedAt: '2026-08-15T10:15:00.000Z',
        });
        render(<PaymentRecoveryQueue initialAttempts={[attempt]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }));

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('Payment status refreshed from PROCESSING to CAPTURED.');
        await waitFor(() => expect(status).toHaveFocus());
        expect(screen.getByText('CAPTURED')).toBeInTheDocument();
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-123' }))
            .toHaveTextContent('Aug 15, 2026, 10:15 AM UTC');
        expect(screen.getByRole('button', { name: 'Payment reconciled' })).toBeDisabled();
    });

    it('exposes pending work on the originating control', async () => {
        let resolve!: (value: unknown) => void;
        mockedReconcile.mockReturnValue(new Promise(value => { resolve = value; }));
        render(<PaymentRecoveryQueue initialAttempts={[attempt]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }));

        const pending = screen.getByRole('button', { name: 'Refreshing payment status…' });
        expect(pending).toBeDisabled();
        expect(pending).toHaveAttribute('aria-busy', 'true');
        resolve({
            ok: true,
            attemptId: attempt.id,
            previousStatus: 'PROCESSING',
            status: 'PROCESSING',
            changed: false,
            updatedAt: '2026-08-15T10:15:00.000Z',
        });
        await screen.findByText('Payment status is still PROCESSING.');
    });

    it('shows safe recoverable feedback and moves focus to it', async () => {
        mockedReconcile.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Payment status could not be refreshed. Try again later.',
                fields: {},
            },
        });
        render(<PaymentRecoveryQueue initialAttempts={[attempt]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Payment status could not be refreshed. Try again later.');
        await waitFor(() => expect(alert).toHaveFocus());
        expect(screen.getByRole('button', { name: 'Refresh payment status' })).toBeEnabled();
    });

    it('filters attempts by Actionable Only vs Reconciled, including after reconciling an attempt into CAPTURED', async () => {
        const secondAttempt = {
            ...attempt,
            id: 'attempt-456',
            checkoutId: 'checkout-456',
            providerIntentId: 'pi_provider_456',
            userName: 'Grace Hopper',
            userEmail: 'grace@example.com',
        };
        mockedReconcile.mockResolvedValue({
            ok: true,
            attemptId: attempt.id,
            previousStatus: 'PROCESSING',
            status: 'CAPTURED',
            changed: true,
            updatedAt: '2026-08-15T10:15:00.000Z',
        });

        render(<PaymentRecoveryQueue initialAttempts={[attempt, secondAttempt]} />);

        const statusFilter = screen.getByTestId('payment-recovery-status-filter');
        expect(statusFilter).toHaveValue('ALL');
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-123' })).toBeInTheDocument();
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-456' })).toBeInTheDocument();

        // Reconcile the first attempt into CAPTURED
        fireEvent.click(screen.getAllByRole('button', { name: 'Refresh payment status' })[0]);
        await screen.findByRole('status');

        // Filter by Actionable Only
        fireEvent.change(statusFilter, { target: { value: 'ACTIONABLE' } });
        expect(screen.queryByRole('article', { name: 'Payment attempt attempt-123' })).not.toBeInTheDocument();
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-456' })).toBeInTheDocument();

        // Filter by Reconciled
        fireEvent.change(statusFilter, { target: { value: 'RECONCILED' } });
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-123' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'Payment attempt attempt-456' })).not.toBeInTheDocument();
    });

    it('searches by customer email or Stripe intent ID and shows empty filter message when no items match', () => {
        const secondAttempt = {
            ...attempt,
            id: 'attempt-456',
            checkoutId: 'checkout-456',
            providerIntentId: 'pi_provider_456',
            userName: 'Grace Hopper',
            userEmail: 'grace@example.com',
        };

        render(<PaymentRecoveryQueue initialAttempts={[attempt, secondAttempt]} />);

        const searchInput = screen.getByTestId('payment-recovery-search');

        // Search by customer email (case-insensitive)
        fireEvent.change(searchInput, { target: { value: 'GRACE@EXAMPLE.COM' } });
        expect(screen.queryByRole('article', { name: 'Payment attempt attempt-123' })).not.toBeInTheDocument();
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-456' })).toBeInTheDocument();

        // Search by Stripe intent ID
        fireEvent.change(searchInput, { target: { value: 'pi_provider_123' } });
        expect(screen.getByRole('article', { name: 'Payment attempt attempt-123' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'Payment attempt attempt-456' })).not.toBeInTheDocument();

        // Search with no matches
        fireEvent.change(searchInput, { target: { value: 'nonexistent-query' } });
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.getByText('No payment attempts match the current filters.')).toBeInTheDocument();
        expect(screen.getByTestId('payment-recovery-search')).toBeInTheDocument();
        expect(screen.getByTestId('payment-recovery-status-filter')).toBeInTheDocument();
    });
});

