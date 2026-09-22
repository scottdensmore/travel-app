import type { Metadata } from 'next';
import React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NotificationService } from '@/lib/notificationService';
import NotificationPreferencesClient from '@/components/profile/NotificationPreferencesClient';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = {
    title: pageTitle('Notification Preferences'),
    description: 'Manage your notification channels and alert preferences for flights, bookings, and travel updates.',
};

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        redirect('/login?callbackUrl=/profile/notifications');
        return null;
    }

    const userId = session.user.id;
    const userEmail = session.user.email ?? '';

    const notificationService = new NotificationService();
    const effectivePreferences = await notificationService.getEffectivePreferences(userId);

    return (
        <NotificationPreferencesClient
            userEmail={userEmail}
            initialPreferences={effectivePreferences}
        />
    );
}
