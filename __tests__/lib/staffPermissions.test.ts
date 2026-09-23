/** @jest-environment node */
import { Role } from '@prisma/client';
import { StaffPermission, ROLE_PERMISSIONS } from '@/lib/staffPermissions';

describe('Staff Permissions Matrix', () => {
    it('grants ADMIN all permissions', () => {
        const allPermissions = Object.values(StaffPermission);
        expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(allPermissions.length);
        for (const permission of allPermissions) {
            expect(ROLE_PERMISSIONS.ADMIN).toContain(permission);
        }
    });

    it('grants SUPPORT bookings, notifications, and user read permissions only', () => {
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_READ);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_WRITE);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_REFUND);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.BOOKINGS_CANCEL);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.NOTIFICATIONS_READ);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.NOTIFICATIONS_RESEND);
        expect(ROLE_PERMISSIONS.SUPPORT).toContain(StaffPermission.USERS_READ);

        // Denied areas
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.SCHEDULES_WRITE);
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.SCHEDULES_DELETE);
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.USERS_MANAGE_ROLES);
        expect(ROLE_PERMISSIONS.SUPPORT).not.toContain(StaffPermission.AUDIT_LOGS_PURGE);
    });

    it('grants OPERATIONS schedule and flight status permissions only', () => {
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.SCHEDULES_READ);
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.SCHEDULES_WRITE);
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.SCHEDULES_DELETE);
        expect(ROLE_PERMISSIONS.OPERATIONS).toContain(StaffPermission.FLIGHT_STATUS_UPDATE);

        // Denied areas
        expect(ROLE_PERMISSIONS.OPERATIONS).not.toContain(StaffPermission.BOOKINGS_REFUND);
        expect(ROLE_PERMISSIONS.OPERATIONS).not.toContain(StaffPermission.USERS_MANAGE_ROLES);
    });

    it('grants MODERATOR review and city guide permissions only', () => {
        expect(ROLE_PERMISSIONS.MODERATOR).toContain(StaffPermission.REVIEWS_MODERATE);
        expect(ROLE_PERMISSIONS.MODERATOR).toContain(StaffPermission.CITY_GUIDES_WRITE);

        // Denied areas
        expect(ROLE_PERMISSIONS.MODERATOR).not.toContain(StaffPermission.BOOKINGS_READ);
        expect(ROLE_PERMISSIONS.MODERATOR).not.toContain(StaffPermission.SCHEDULES_WRITE);
    });

    it('grants USER zero staff permissions', () => {
        expect(ROLE_PERMISSIONS.USER).toEqual([]);
    });
});
