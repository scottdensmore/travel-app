import { Session } from 'next-auth';
import { Role } from '@prisma/client';
import { StaffPermission, ROLE_PERMISSIONS } from './staffPermissions';

export function isStaffRole(role?: Role | null): boolean {
    return role !== undefined && role !== null && role !== 'USER';
}

export function hasStaffPermission(
    session: Session | null,
    permission: StaffPermission
): boolean {
    if (!session?.user?.role || !isStaffRole(session.user.role)) return false;
    if (session.user.staffMfaVerified !== true) return false;
    const permissions = ROLE_PERMISSIONS[session.user.role] ?? [];
    return permissions.includes(permission);
}

export function hasVerifiedStaffAccess(session: Session | null): boolean {
    return isStaffRole(session?.user?.role) && session?.user?.staffMfaVerified === true;
}
