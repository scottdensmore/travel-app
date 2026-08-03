import type { Metadata } from 'next';
import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import StaffMfaEnrollment from './StaffMfaEnrollment';

export const metadata: Metadata = {
    title: 'Staff verification',
    description: 'Set up or confirm the authenticator required for staff access.',
};

export const dynamic = 'force-dynamic';

export default async function StaffMfaPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user) redirect('/login');
    if (session.user.role !== 'ADMIN') redirect('/');
    if (session.user.staffMfaVerified) redirect('/admin');
    if (!session.user.staffMfaEnrollmentRequired) redirect('/login');

    return (
        <main className="page-container staff-mfa-page">
            <StaffMfaEnrollment />
        </main>
    );
}
