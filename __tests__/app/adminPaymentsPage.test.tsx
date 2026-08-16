/** @jest-environment node */

import React from 'react';
import AdminPaymentsPage from '@/app/admin/payments/page';
import PaymentRecoveryQueue from '@/components/ui/PaymentRecoveryQueue';
import { listStalePaymentAttempts } from '@/lib/paymentRecovery';

jest.mock('@/lib/paymentRecovery', () => ({
    listStalePaymentAttempts: jest.fn(),
}));
jest.mock('@/components/ui/PaymentRecoveryQueue', () => ({
    __esModule: true,
    default: function PaymentRecoveryQueueBoundary() {
        return null;
    },
}));

const mockedList = listStalePaymentAttempts as jest.Mock;

function findElement(node: unknown, type: React.ElementType): React.ReactElement | null {
    if (!React.isValidElement(node)) return null;
    if (node.type === type) return node;
    const children = React.Children.toArray(
        (node.props as { children?: React.ReactNode }).children,
    );
    for (const child of children) {
        const found = findElement(child, type);
        if (found) return found;
    }
    return null;
}

describe('/admin/payments', () => {
    it('loads the bounded stale-attempt queue and serializes dates for the client boundary', async () => {
        mockedList.mockResolvedValue([{
            id: 'attempt-123',
            checkoutId: 'checkout-123',
            providerIntentId: 'pi_provider_123',
            amountCents: 72_500,
            currency: 'USD',
            status: 'PROCESSING',
            updatedAt: new Date('2026-08-15T10:00:00.000Z'),
            userName: 'Ada Lovelace',
            userEmail: 'ada@example.com',
        }]);

        const queue = findElement(await AdminPaymentsPage(), PaymentRecoveryQueue);

        expect(mockedList).toHaveBeenCalledTimes(1);
        expect(queue).not.toBeNull();
        expect(queue!.props).toMatchObject({
            initialAttempts: [{
                id: 'attempt-123',
                updatedAt: '2026-08-15T10:00:00.000Z',
            }],
        });
    });
});
