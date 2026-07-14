import { Session } from 'next-auth';

export function hasVerifiedStaffAccess(session: Session | null): boolean {
    return session?.user?.role === 'ADMIN' && session.user.staffMfaVerified === true;
}
