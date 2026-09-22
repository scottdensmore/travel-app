import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationPreferencesClient from '@/components/profile/NotificationPreferencesClient';
import * as actions from '@/app/actions/notificationActions';

jest.mock('@/app/actions/notificationActions', () => ({
    updateNotificationPreferencesAction: jest.fn(),
    getNotificationPreferencesAction: jest.fn(),
}));

describe('NotificationPreferencesClient', () => {
    const initialPreferences = {
        FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
        ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
        TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders category rows and channel toggles', () => {
        render(
            <NotificationPreferencesClient
                userEmail="alex@example.com"
                initialPreferences={initialPreferences}
            />
        );

        expect(screen.getByText(/Flight Status/i)).toBeInTheDocument();
        expect(screen.getByText(/Account & Bookings/i)).toBeInTheDocument();
        expect(screen.getByText(/Travel Guides & Tips/i)).toBeInTheDocument();
        expect(screen.getByText('alex@example.com')).toBeInTheDocument();

        const switches = screen.getAllByRole('switch');
        expect(switches.length).toBe(6);
    });

    it('triggers action on toggle and displays success status', async () => {
        (actions.updateNotificationPreferencesAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { success: true },
        });

        render(
            <NotificationPreferencesClient
                userEmail="alex@example.com"
                initialPreferences={initialPreferences}
            />
        );

        const emailGuideToggle = screen.getByLabelText(/Travel Guides & Tips Email/i);
        expect(emailGuideToggle).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(emailGuideToggle);

        expect(emailGuideToggle).toHaveAttribute('aria-checked', 'true');

        await waitFor(() => {
            expect(actions.updateNotificationPreferencesAction).toHaveBeenCalledWith([
                { category: 'TRAVEL_GUIDES', channel: 'EMAIL', enabled: true },
            ]);
            expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
        });
    });

    it('reverts state and displays error if action returns failure', async () => {
        (actions.updateNotificationPreferencesAction as jest.Mock).mockResolvedValue({
            ok: false,
            error: { message: 'Server error saving preferences' },
        });

        render(
            <NotificationPreferencesClient
                userEmail="alex@example.com"
                initialPreferences={initialPreferences}
            />
        );

        const inAppFlightToggle = screen.getByLabelText(/Flight Status & Operational Alerts In-App/i);
        expect(inAppFlightToggle).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(inAppFlightToggle);

        // Optimistically set to false
        expect(inAppFlightToggle).toHaveAttribute('aria-checked', 'false');

        await waitFor(() => {
            expect(actions.updateNotificationPreferencesAction).toHaveBeenCalledWith([
                { category: 'FLIGHT_STATUS', channel: 'IN_APP', enabled: false },
            ]);
            expect(screen.getByRole('alert')).toHaveTextContent(/Server error saving preferences/i);
            // Reverted back to true
            expect(inAppFlightToggle).toHaveAttribute('aria-checked', 'true');
        });
    });

    it('uses native button switch allowing keyboard activation via click', async () => {
        (actions.updateNotificationPreferencesAction as jest.Mock).mockResolvedValue({
            ok: true,
            data: { success: true },
        });

        render(
            <NotificationPreferencesClient
                userEmail="alex@example.com"
                initialPreferences={initialPreferences}
            />
        );

        const inAppGuideToggle = screen.getByLabelText(/Travel Guides & Tips In-App/i);
        expect(inAppGuideToggle.tagName).toBe('BUTTON');
        expect(inAppGuideToggle).toHaveAttribute('type', 'button');
        expect(inAppGuideToggle).toHaveAttribute('role', 'switch');
        expect(inAppGuideToggle).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(inAppGuideToggle);

        await waitFor(() => {
            expect(actions.updateNotificationPreferencesAction).toHaveBeenCalledWith([
                { category: 'TRAVEL_GUIDES', channel: 'IN_APP', enabled: false },
            ]);
            expect(inAppGuideToggle).toHaveAttribute('aria-checked', 'false');
        });
    });
});
