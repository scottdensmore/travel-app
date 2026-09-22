import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminNotificationDeliveriesClient from '@/components/admin/AdminNotificationDeliveriesClient';
import * as actions from '@/app/actions/notificationActions';

jest.mock('@/app/actions/notificationActions', () => ({
    getAdminNotificationDeliveriesAction: jest.fn(),
    retryNotificationDeliveryAction: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn() }),
}));

describe('AdminNotificationDeliveriesClient', () => {
    const mockDeliveries = [
        {
            id: 'del-1',
            channel: 'EMAIL',
            status: 'FAILED',
            recipient: 'traveler@example.com',
            error: 'SMTP Timeout 504',
            attempts: 1,
            createdAt: '2026-09-21T12:00:00.000Z',
            notification: {
                id: 'notif-1',
                title: 'Flight Delayed',
                message: 'Your flight is delayed by 45 mins.',
                category: 'FLIGHT_STATUS',
                userId: 'user-1',
                isRead: false,
                createdAt: '2026-09-21T12:00:00.000Z',
            },
        },
        {
            id: 'del-2',
            channel: 'IN_APP',
            status: 'SENT',
            recipient: 'user-2',
            error: null,
            attempts: 1,
            createdAt: '2026-09-21T11:00:00.000Z',
            notification: {
                id: 'notif-2',
                title: 'Welcome Aboard',
                message: 'Thank you for booking with Mona Airways.',
                category: 'ACCOUNT_ACTIVITY',
                userId: 'user-2',
                isRead: true,
                createdAt: '2026-09-21T11:00:00.000Z',
            },
        },
        {
            id: 'del-3',
            channel: 'EMAIL',
            status: 'PENDING',
            recipient: 'wanderer@example.com',
            error: null,
            attempts: 0,
            createdAt: '2026-09-21T10:00:00.000Z',
            notification: {
                id: 'notif-3',
                title: 'Explore Paris',
                message: 'Check out the top attractions in Paris.',
                category: 'TRAVEL_GUIDES',
                userId: 'user-3',
                isRead: false,
                createdAt: '2026-09-21T10:00:00.000Z',
            },
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders delivery records, metric cards, status badges, and error message inspector', () => {
        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={3}
                sentCount={1}
                failedCount={1}
                pendingCount={1}
            />
        );

        // Metric cards
        expect(screen.getByText('Total Dispatches')).toBeInTheDocument();
        expect(screen.getByText('Sent Count')).toBeInTheDocument();
        expect(screen.getByText('Failed Count')).toBeInTheDocument();
        expect(screen.getByText('Pending Count')).toBeInTheDocument();

        // Deliveries content
        expect(screen.getByText('traveler@example.com')).toBeInTheDocument();
        expect(screen.getByText('SMTP Timeout 504')).toBeInTheDocument();
        expect(screen.getByText('Flight Delayed')).toBeInTheDocument();
        expect(screen.getByText('Your flight is delayed by 45 mins.')).toBeInTheDocument();

        expect(screen.getByText('user-2')).toBeInTheDocument();
        expect(screen.getByText('Welcome Aboard')).toBeInTheDocument();

        expect(screen.getByText('wanderer@example.com')).toBeInTheDocument();
        expect(screen.getByText('Explore Paris')).toBeInTheDocument();

        // Status badges
        expect(screen.getByText('FAILED')).toBeInTheDocument();
        expect(screen.getByText('SENT')).toBeInTheDocument();
        expect(screen.getByText('PENDING')).toBeInTheDocument();
    });

    it('handles retry click, calls retryNotificationDeliveryAction, and shows accessible status feedback', async () => {
        (actions.retryNotificationDeliveryAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { success: true, delivery: { ...mockDeliveries[0], status: 'SENT', error: null, attempts: 2 } },
        });

        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={3}
                sentCount={1}
                failedCount={1}
                pendingCount={1}
            />
        );

        expect(screen.getByText('traveler@example.com')).toBeInTheDocument();
        expect(screen.getByText('SMTP Timeout 504')).toBeInTheDocument();

        const retryButton = screen.getByRole('button', { name: /Retry/i });
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(actions.retryNotificationDeliveryAction).toHaveBeenCalledWith('del-1');
        });

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeInTheDocument();
            expect(screen.getByText(/retried successfully/i)).toBeInTheDocument();
        });
    });

    it('shows accessible error alert when retry fails', async () => {
        (actions.retryNotificationDeliveryAction as jest.Mock).mockResolvedValue({
            ok: false,
            error: { code: 'RETRY_ERROR', message: 'SMTP Host unreachable' },
        });

        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={3}
            />
        );

        const retryButton = screen.getByRole('button', { name: /Retry/i });
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(actions.retryNotificationDeliveryAction).toHaveBeenCalledWith('del-1');
        });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('SMTP Host unreachable')).toBeInTheDocument();
        });
    });

    it('filters deliveries by status tab using getAdminNotificationDeliveriesAction', async () => {
        (actions.getAdminNotificationDeliveriesAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { deliveries: [mockDeliveries[0]], totalCount: 1 },
        });

        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={3}
            />
        );

        const failedTab = screen.getByRole('tab', { name: /Failed/i });
        fireEvent.click(failedTab);

        await waitFor(() => {
            expect(actions.getAdminNotificationDeliveriesAction).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'FAILED' })
            );
        });
    });

    it('filters deliveries by channel and search input', async () => {
        (actions.getAdminNotificationDeliveriesAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { deliveries: [mockDeliveries[1]], totalCount: 1 },
        });

        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={3}
            />
        );

        const channelSelect = screen.getByRole('combobox', { name: /Channel/i });
        fireEvent.change(channelSelect, { target: { value: 'IN_APP' } });

        await waitFor(() => {
            expect(actions.getAdminNotificationDeliveriesAction).toHaveBeenCalledWith(
                expect.objectContaining({ channel: 'IN_APP' })
            );
        });

        const searchInput = screen.getByPlaceholderText(/search/i);
        fireEvent.change(searchInput, { target: { value: 'Welcome' } });

        const searchButton = screen.getByRole('button', { name: /Search/i });
        fireEvent.click(searchButton);

        await waitFor(() => {
            expect(actions.getAdminNotificationDeliveriesAction).toHaveBeenCalledWith(
                expect.objectContaining({ search: 'Welcome' })
            );
        });
    });

    it('renders pagination controls and navigates between pages', async () => {
        (actions.getAdminNotificationDeliveriesAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: {
                deliveries: [mockDeliveries[0]],
                totalCount: 120,
            },
        });

        render(
            <AdminNotificationDeliveriesClient
                initialDeliveries={mockDeliveries as any}
                totalCount={120}
            />
        );

        expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
        const prevButton = screen.getByRole('button', { name: /Previous page/i });
        const nextButton = screen.getByRole('button', { name: /Next page/i });

        expect(prevButton).toBeDisabled();
        expect(nextButton).not.toBeDisabled();

        fireEvent.click(nextButton);

        await waitFor(() => {
            expect(actions.getAdminNotificationDeliveriesAction).toHaveBeenCalledWith(
                expect.objectContaining({ page: 2, pageSize: 50 })
            );
        });

        await waitFor(() => {
            expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
        });

        (actions.getAdminNotificationDeliveriesAction as jest.Mock).mockResolvedValueOnce({
            ok: true,
            data: {
                deliveries: [mockDeliveries[1]],
                totalCount: 120,
            },
        });

        fireEvent.click(prevButton);

        await waitFor(() => {
            expect(actions.getAdminNotificationDeliveriesAction).toHaveBeenCalledWith(
                expect.objectContaining({ page: 1, pageSize: 50 })
            );
        });
    });
});
