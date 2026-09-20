import type { Metadata } from 'next';
import React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { checkAccountDeletionEligibility } from '@/lib/privacyService';
import PrivacySettingsClient from '@/components/profile/PrivacySettingsClient';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = {
    title: pageTitle('Privacy & Data'),
    description: 'Manage your personal data, download an export of your travel records, or delete your account under GDPR and CCPA.',
};

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        redirect('/login?callbackUrl=/profile/privacy');
        return null;
    }

    const userId = session.user.id;
    const userEmail = session.user.email ?? '';
    const userName = session.user.name ?? 'Traveler';

    const eligibility = await checkAccountDeletionEligibility(userId);

    return (
        <PrivacySettingsClient
            userId={userId}
            userEmail={userEmail}
            userName={userName}
            initialEligibility={eligibility}
        />
    );
}
