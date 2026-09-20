/**
 * @jest-environment node
 */
import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import PrivacyPage, { metadata } from '@/app/profile/privacy/page';
import { checkAccountDeletionEligibility } from '@/lib/privacyService';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    redirect: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/privacyService', () => ({
    checkAccountDeletionEligibility: jest.fn(),
}));

jest.mock('@/components/profile/PrivacySettingsClient', () => {
    return function MockPrivacySettingsClient(props: any) {
        return <div data-testid="privacy-settings-client" data-props={JSON.stringify(props)} />;
    };
});

describe('PrivacyPage Route', () => {
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

        await PrivacyPage();

        expect(redirect).toHaveBeenCalledWith('/login?callbackUrl=/profile/privacy');
    });

    it('renders PrivacySettingsClient with user details and deletion eligibility', async () => {
        const userId = 'usr-123';
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: userId, email: 'alex@example.com', name: 'Alex Traveler' },
        });

        const mockEligibility = {
            eligible: true,
            reason: null,
            message: null,
            upcomingBookingsCount: 0,
        };
        (checkAccountDeletionEligibility as jest.Mock).mockResolvedValue(mockEligibility);

        const pageElement = await PrivacyPage();

        expect(checkAccountDeletionEligibility).toHaveBeenCalledWith(userId);
        expect(pageElement).not.toBeNull();
        expect(pageElement!.type).toBeDefined();
        expect(pageElement!.props).toEqual({
            userId,
            userEmail: 'alex@example.com',
            userName: 'Alex Traveler',
            initialEligibility: mockEligibility,
        });
    });
});
