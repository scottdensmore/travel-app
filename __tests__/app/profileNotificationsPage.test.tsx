/**
 * @jest-environment node
 */
import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import NotificationsPage, { metadata } from '@/app/profile/notifications/page';
import { NotificationService } from '@/lib/notificationService';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    redirect: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/notificationService', () => {
    return {
        NotificationService: jest.fn().mockImplementation(() => ({
            getEffectivePreferences: jest.fn(),
        })),
    };
});

jest.mock('@/components/profile/NotificationPreferencesClient', () => {
    return function MockNotificationPreferencesClient(props: any) {
        return <div data-testid="notification-preferences-client" data-props={JSON.stringify(props)} />;
    };
});

describe('NotificationsPage Route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('defines route metadata with title and description', () => {
        expect(metadata.title).toBeDefined();
        expect(metadata.description).toBeDefined();
        expect(typeof metadata.title).toBe('string');
        expect(typeof metadata.description).toBe('string');
    });

    it('redirects to login if user is not authenticated', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);

        await NotificationsPage();

        expect(redirect).toHaveBeenCalledWith('/login?callbackUrl=/profile/notifications');
    });

    it('loads effective preferences and renders NotificationPreferencesClient for authenticated user', async () => {
        const userId = 'usr-test-123';
        const userEmail = 'traveler@example.com';
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: userId, email: userEmail, name: 'Traveler Jane' },
        });

        const mockEffectivePreferences = {
            FLIGHT_STATUS: { IN_APP: true, EMAIL: true },
            ACCOUNT_ACTIVITY: { IN_APP: true, EMAIL: true },
            TRAVEL_GUIDES: { IN_APP: true, EMAIL: false },
        };

        const mockGetEffectivePreferences = jest.fn().mockResolvedValue(mockEffectivePreferences);
        (NotificationService as unknown as jest.Mock).mockImplementation(() => ({
            getEffectivePreferences: mockGetEffectivePreferences,
        }));

        const pageElement = await NotificationsPage();

        expect(mockGetEffectivePreferences).toHaveBeenCalledWith(userId);
        expect(pageElement).not.toBeNull();
        expect(pageElement!.type).toBeDefined();
        expect(pageElement!.props).toEqual({
            userEmail,
            initialPreferences: mockEffectivePreferences,
        });
    });
});
