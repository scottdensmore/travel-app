import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await getServerSession(authOptions);
    if (!hasVerifiedStaffAccess(session)) {
        if (session?.user?.role === 'ADMIN' && session.user.staffMfaEnrollmentRequired) {
            redirect('/staff/mfa');
        }
        redirect('/login');
    }
    return children;
}
