/** @jest-environment node */
import {
    hasVerifiedStaffAccess,
    hasStaffPermission,
    isStaffRole,
} from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';

describe('Staff Authorization Helpers', () => {
    describe('isStaffRole', () => {
        it('returns true for staff roles', () => {
            expect(isStaffRole('ADMIN')).toBe(true);
            expect(isStaffRole('SUPPORT')).toBe(true);
            expect(isStaffRole('OPERATIONS')).toBe(true);
            expect(isStaffRole('MODERATOR')).toBe(true);
        });

        it('returns false for USER, undefined, or null', () => {
            expect(isStaffRole('USER')).toBe(false);
            expect(isStaffRole(undefined)).toBe(false);
            expect(isStaffRole(null)).toBe(false);
        });
    });

    describe('hasStaffPermission', () => {
        it('returns false if session is missing or MFA is unverified', () => {
            expect(hasStaffPermission(null, StaffPermission.BOOKINGS_READ)).toBe(false);
            expect(hasStaffPermission({
                user: { id: 'u1', role: 'ADMIN', staffMfaVerified: false }
            } as never, StaffPermission.BOOKINGS_READ)).toBe(false);
        });

        it('returns true when role possesses the requested permission and MFA is verified', () => {
            expect(hasStaffPermission({
                user: { id: 'u1', role: 'SUPPORT', staffMfaVerified: true }
            } as never, StaffPermission.BOOKINGS_REFUND)).toBe(true);

            expect(hasStaffPermission({
                user: { id: 'u1', role: 'OPERATIONS', staffMfaVerified: true }
            } as never, StaffPermission.SCHEDULES_WRITE)).toBe(true);
        });

        it('returns false when role lacks the requested permission even if MFA is verified', () => {
            expect(hasStaffPermission({
                user: { id: 'u1', role: 'SUPPORT', staffMfaVerified: true }
            } as never, StaffPermission.SCHEDULES_DELETE)).toBe(false);

            expect(hasStaffPermission({
                user: { id: 'u1', role: 'OPERATIONS', staffMfaVerified: true }
            } as never, StaffPermission.USERS_MANAGE_ROLES)).toBe(false);
        });
    });

    describe('hasVerifiedStaffAccess (backward compatibility)', () => {
        it('returns true for any staff role with verified MFA', () => {
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'ADMIN', staffMfaVerified: true } } as never)).toBe(true);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'SUPPORT', staffMfaVerified: true } } as never)).toBe(true);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'OPERATIONS', staffMfaVerified: true } } as never)).toBe(true);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'MODERATOR', staffMfaVerified: true } } as never)).toBe(true);
        });

        it('returns false for USER role or unverified MFA', () => {
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'USER', staffMfaVerified: true } } as never)).toBe(false);
            expect(hasVerifiedStaffAccess({ user: { id: 'u1', role: 'ADMIN', staffMfaVerified: false } } as never)).toBe(false);
        });
    });
});
