import { Role } from '@prisma/client';

export enum StaffPermission {
    BOOKINGS_READ = 'BOOKINGS_READ',
    BOOKINGS_WRITE = 'BOOKINGS_WRITE',
    BOOKINGS_REFUND = 'BOOKINGS_REFUND',
    BOOKINGS_CANCEL = 'BOOKINGS_CANCEL',
    SCHEDULES_READ = 'SCHEDULES_READ',
    SCHEDULES_WRITE = 'SCHEDULES_WRITE',
    SCHEDULES_DELETE = 'SCHEDULES_DELETE',
    FLIGHT_STATUS_UPDATE = 'FLIGHT_STATUS_UPDATE',
    REVIEWS_MODERATE = 'REVIEWS_MODERATE',
    CITY_GUIDES_WRITE = 'CITY_GUIDES_WRITE',
    NOTIFICATIONS_READ = 'NOTIFICATIONS_READ',
    NOTIFICATIONS_RESEND = 'NOTIFICATIONS_RESEND',
    USERS_READ = 'USERS_READ',
    USERS_MANAGE_ROLES = 'USERS_MANAGE_ROLES',
    AUDIT_LOGS_VIEW = 'AUDIT_LOGS_VIEW',
    AUDIT_LOGS_PURGE = 'AUDIT_LOGS_PURGE',
}

export const ROLE_PERMISSIONS: Record<Role, readonly StaffPermission[]> = {
    USER: [],
    ADMIN: Object.values(StaffPermission),
    SUPPORT: [
        StaffPermission.BOOKINGS_READ,
        StaffPermission.BOOKINGS_WRITE,
        StaffPermission.BOOKINGS_REFUND,
        StaffPermission.BOOKINGS_CANCEL,
        StaffPermission.NOTIFICATIONS_READ,
        StaffPermission.NOTIFICATIONS_RESEND,
        StaffPermission.USERS_READ,
    ],
    OPERATIONS: [
        StaffPermission.SCHEDULES_READ,
        StaffPermission.SCHEDULES_WRITE,
        StaffPermission.SCHEDULES_DELETE,
        StaffPermission.FLIGHT_STATUS_UPDATE,
    ],
    MODERATOR: [
        StaffPermission.REVIEWS_MODERATE,
        StaffPermission.CITY_GUIDES_WRITE,
    ],
};
