/**
 * @jest-environment node
 */
import {
    searchBookingsAction,
    cancelBookingAction,
    addBookingNoteAction,
    resendEmailAction,
} from '@/app/admin/bookings/actions';
import { getServerSession } from 'next-auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import {
    assertPrivilegedStaffOperation,
    StaffUnauthorizedError,
    StaffStepUpRequiredError,
} from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import * as customerSupportService from '@/lib/customerSupportService';
import { revalidatePath } from 'next/cache';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/staffAuthorization', () => ({
    hasStaffPermission: jest.fn(),
}));

jest.mock('@/lib/staffMfa', () => ({
    assertPrivilegedStaffOperation: jest.fn(),
    StaffUnauthorizedError: class StaffUnauthorizedError extends Error {
        constructor(message = 'Unauthorized staff access.') {
            super(message);
            this.name = 'StaffUnauthorizedError';
        }
    },
    StaffStepUpRequiredError: class StaffStepUpRequiredError extends Error {
        permission: unknown;
        constructor(permission: unknown, message = 'Step-up security verification required.') {
            super(message);
            this.name = 'StaffStepUpRequiredError';
            this.permission = permission;
        }
    },
}));

jest.mock('@/lib/staffAuditService', () => ({
    recordStaffAudit: jest.fn(),
}));

jest.mock('@/lib/customerSupportService', () => ({
    searchBookings: jest.fn(),
    cancelAndRefundBooking: jest.fn(),
    addInternalNote: jest.fn(),
    resendConfirmationEmail: jest.fn(),
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

describe('Admin Bookings Server Actions', () => {
    const mockSession = {
        user: {
            id: 'staff-user-1',
            email: 'staff@example.com',
            role: 'SUPPORT',
            staffMfaVerified: true,
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('searchBookingsAction', () => {
        it('rejects unauthorized access when session lacks BOOKINGS_READ permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(searchBookingsAction({})).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_READ);
            expect(customerSupportService.searchBookings).not.toHaveBeenCalled();
        });

        it('rejects unauthenticated access when session is null', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(searchBookingsAction({})).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(null, StaffPermission.BOOKINGS_READ);
        });

        it('searches bookings when user has BOOKINGS_READ permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            const mockResults = [{ id: 1, reference: 'REF123' }];
            (customerSupportService.searchBookings as jest.Mock).mockResolvedValue(mockResults);

            const result = await searchBookingsAction({ reference: 'REF123' });

            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_READ);
            expect(customerSupportService.searchBookings).toHaveBeenCalledWith({ reference: 'REF123' });
            expect(result).toEqual(mockResults);
        });
    });

    describe('addBookingNoteAction', () => {
        it('rejects unauthorized access when session lacks BOOKINGS_WRITE_NOTES permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(addBookingNoteAction(1, 'Internal note')).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_WRITE_NOTES);
            expect(customerSupportService.addInternalNote).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('adds internal note and logs staff audit when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            (customerSupportService.addInternalNote as jest.Mock).mockResolvedValue(undefined);

            await addBookingNoteAction(1, 'Internal note');

            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_WRITE_NOTES);
            expect(customerSupportService.addInternalNote).toHaveBeenCalledWith(1, 'staff-user-1', 'Internal note');
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                action: 'BOOKING_ADD_NOTE',
                targetType: 'Booking',
                targetId: '1',
                reason: 'Support staff added internal booking note',
            }));
            expect(revalidatePath).toHaveBeenCalledWith('/admin/bookings');
        });
    });

    describe('resendEmailAction', () => {
        it('rejects unauthorized access when session lacks NOTIFICATIONS_RESEND permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(resendEmailAction(1)).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.NOTIFICATIONS_RESEND);
            expect(customerSupportService.resendConfirmationEmail).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('resends email and logs staff audit when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            (customerSupportService.resendConfirmationEmail as jest.Mock).mockResolvedValue(undefined);

            await resendEmailAction(1);

            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.NOTIFICATIONS_RESEND);
            expect(customerSupportService.resendConfirmationEmail).toHaveBeenCalledWith(1);
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                action: 'BOOKING_RESEND_EMAIL',
                targetType: 'Booking',
                targetId: '1',
                reason: 'Staff resent booking confirmation email',
            }));
        });
    });

    describe('cancelBookingAction', () => {
        it('propagates error when assertPrivilegedStaffOperation throws StaffUnauthorizedError', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (assertPrivilegedStaffOperation as jest.Mock).mockRejectedValue(new StaffUnauthorizedError());

            await expect(cancelBookingAction(1, 'Customer cancellation')).rejects.toThrow(StaffUnauthorizedError);
            expect(assertPrivilegedStaffOperation).toHaveBeenCalledWith({
                session: mockSession,
                permission: StaffPermission.BOOKINGS_REFUND,
                stepUpCode: undefined,
            });
            expect(customerSupportService.cancelAndRefundBooking).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('propagates error when assertPrivilegedStaffOperation throws StaffStepUpRequiredError', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (assertPrivilegedStaffOperation as jest.Mock).mockRejectedValue(
                new StaffStepUpRequiredError(StaffPermission.BOOKINGS_REFUND)
            );

            await expect(cancelBookingAction(1, 'Customer cancellation', 'invalid')).rejects.toThrow(StaffStepUpRequiredError);
            expect(customerSupportService.cancelAndRefundBooking).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('cancels, refunds, and logs audit when assertPrivilegedStaffOperation succeeds', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (assertPrivilegedStaffOperation as jest.Mock).mockResolvedValue({
                actorId: 'staff-user-1',
                userId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
            });
            (customerSupportService.cancelAndRefundBooking as jest.Mock).mockResolvedValue(undefined);

            await cancelBookingAction(1, 'Customer requested refund', '123456');

            expect(assertPrivilegedStaffOperation).toHaveBeenCalledWith({
                session: mockSession,
                permission: StaffPermission.BOOKINGS_REFUND,
                stepUpCode: '123456',
            });
            expect(customerSupportService.cancelAndRefundBooking).toHaveBeenCalledWith(1, 'staff-user-1', 'Customer requested refund');
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                actorUserId: 'staff-user-1',
                action: 'BOOKING_CANCEL_REFUND',
                targetType: 'Booking',
                targetId: '1',
                reason: 'Customer requested refund',
                beforeState: { status: 'CONFIRMED' },
                afterState: { status: 'CANCELLED' },
            }));
            expect(revalidatePath).toHaveBeenCalledWith('/admin/bookings');
        });
    });
});
