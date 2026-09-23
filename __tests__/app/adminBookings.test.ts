/**
 * @jest-environment node
 */
import {
    searchBookingsAction,
    getBookingNotesAction,
    addBookingNoteAction,
    resendEmailAction,
    resendConfirmationEmailAction,
    resendReceiptEmailAction,
    staffChangeBookingSeatsAction,
    staffRebookItineraryAction,
    cancelBookingAction,
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
    getBookingNotes: jest.fn(),
    cancelAndRefundBooking: jest.fn(),
    addInternalNote: jest.fn(),
    resendConfirmationEmail: jest.fn(),
    resendReceiptEmail: jest.fn(),
    staffChangeBookingSeats: jest.fn(),
    staffRebookItinerary: jest.fn(),
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
            const mockResults = Object.assign([{ id: 1, reference: 'REF123' }], {
                bookings: [{ id: 1, reference: 'REF123' }],
                totalCount: 1,
                page: 1,
                pageSize: 25,
                totalPages: 1,
            });
            (customerSupportService.searchBookings as jest.Mock).mockResolvedValue(mockResults);

            const result = await searchBookingsAction({ reference: 'REF123' });

            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_READ);
            expect(customerSupportService.searchBookings).toHaveBeenCalledWith({ reference: 'REF123' });
            expect(result).toEqual(mockResults);
        });
    });

    describe('getBookingNotesAction', () => {
        it('rejects unauthorized access when session lacks BOOKINGS_READ permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(getBookingNotesAction(101)).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_READ);
            expect(customerSupportService.getBookingNotes).not.toHaveBeenCalled();
        });

        it('returns notes when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            const mockNotes = [
                {
                    id: 'note-1',
                    bookingId: 101,
                    actorUserId: 'staff-user-1',
                    text: 'Customer called about delay',
                    createdAt: new Date(),
                    actor: { id: 'staff-user-1', name: 'Support Rep', email: 'staff@example.com', role: 'SUPPORT' },
                },
            ];
            (customerSupportService.getBookingNotes as jest.Mock).mockResolvedValue(mockNotes);

            const result = await getBookingNotesAction(101);

            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_READ);
            expect(customerSupportService.getBookingNotes).toHaveBeenCalledWith(101);
            expect(result).toEqual(mockNotes);
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

        it('rejects empty or whitespace-only note', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);

            await expect(addBookingNoteAction(1, '   ')).rejects.toThrow('Note text cannot be empty.');
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
                actorId: 'staff-user-1',
                actorUserId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
                action: 'BOOKING_ADD_NOTE',
                targetType: 'Booking',
                targetId: '1',
                reason: expect.any(String),
                afterState: { noteSnippet: 'Internal note', noteLength: 13 },
            }));
            expect(revalidatePath).toHaveBeenCalledWith('/admin/bookings');
        });
    });

    describe('resendEmailAction and resendConfirmationEmailAction', () => {
        it('rejects unauthorized access when session lacks NOTIFICATIONS_RESEND permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(resendEmailAction(1)).rejects.toThrow('Unauthorized');
            await expect(resendConfirmationEmailAction(1)).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.NOTIFICATIONS_RESEND);
            expect(customerSupportService.resendConfirmationEmail).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('resends confirmation email and logs staff audit when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            (customerSupportService.resendConfirmationEmail as jest.Mock).mockResolvedValue({
                success: true,
                sentTo: 'customer@example.com',
            });

            const result = await resendEmailAction(1);

            expect(result).toEqual({ success: true, sentTo: 'customer@example.com' });
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.NOTIFICATIONS_RESEND);
            expect(customerSupportService.resendConfirmationEmail).toHaveBeenCalledWith(1);
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                actorId: 'staff-user-1',
                actorUserId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
                action: 'BOOKING_RESEND_CONFIRMATION',
                targetType: 'Booking',
                targetId: '1',
                reason: 'Staff resent booking confirmation email',
                afterState: { sentTo: 'customer@example.com' },
            }));
        });

        it('resendConfirmationEmailAction alias behaves identically to resendEmailAction', () => {
            expect(resendConfirmationEmailAction).toBe(resendEmailAction);
        });
    });

    describe('resendReceiptEmailAction', () => {
        it('rejects unauthorized access when session lacks NOTIFICATIONS_RESEND permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(resendReceiptEmailAction(101)).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.NOTIFICATIONS_RESEND);
            expect(customerSupportService.resendReceiptEmail).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('resends receipt email and logs staff audit when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            (customerSupportService.resendReceiptEmail as jest.Mock).mockResolvedValue({
                success: true,
                sentTo: 'customer@example.com',
            });

            const result = await resendReceiptEmailAction(101);

            expect(result).toEqual({ success: true, sentTo: 'customer@example.com' });
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.NOTIFICATIONS_RESEND);
            expect(customerSupportService.resendReceiptEmail).toHaveBeenCalledWith(101);
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                actorId: 'staff-user-1',
                actorUserId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
                action: 'BOOKING_RESEND_RECEIPT',
                targetType: 'Booking',
                targetId: '101',
                reason: 'Staff resent tax invoice & receipt email',
                afterState: { sentTo: 'customer@example.com' },
            }));
        });
    });

    describe('staffChangeBookingSeatsAction', () => {
        it('rejects unauthorized access when session lacks BOOKINGS_WRITE permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(
                staffChangeBookingSeatsAction(101, [{ passengerId: 'p1', legId: 1, seatNumber: '12A' }], 'Requested aisle seat')
            ).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_WRITE);
            expect(customerSupportService.staffChangeBookingSeats).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('executes seat change, logs staff audit, and calls revalidatePath when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            (customerSupportService.staffChangeBookingSeats as jest.Mock).mockResolvedValue(undefined);

            const seatChanges = [{ passengerId: 'p1', legId: 1, seatNumber: '12A' }];
            await staffChangeBookingSeatsAction(101, seatChanges, 'Requested aisle seat');

            expect(customerSupportService.staffChangeBookingSeats).toHaveBeenCalledWith(
                101,
                seatChanges,
                'staff-user-1',
                'Requested aisle seat'
            );
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                actorId: 'staff-user-1',
                actorUserId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
                action: 'BOOKING_SEAT_CHANGE',
                targetType: 'Booking',
                targetId: '101',
                reason: 'Requested aisle seat',
                afterState: { seatChanges },
            }));
            expect(revalidatePath).toHaveBeenCalledWith('/admin/bookings');
        });
    });

    describe('staffRebookItineraryAction', () => {
        it('rejects unauthorized access when session lacks BOOKINGS_WRITE permission', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(false);

            await expect(
                staffRebookItineraryAction(101, { bookingId: 101, replacements: [] }, 'Weather cancellation')
            ).rejects.toThrow('Unauthorized');
            expect(hasStaffPermission).toHaveBeenCalledWith(mockSession, StaffPermission.BOOKINGS_WRITE);
            expect(customerSupportService.staffRebookItinerary).not.toHaveBeenCalled();
            expect(recordStaffAudit).not.toHaveBeenCalled();
        });

        it('executes rebooking, logs staff audit, and calls revalidatePath when authorized', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);
            (hasStaffPermission as jest.Mock).mockReturnValue(true);
            const mockRebookResult = {
                bookingId: 101,
                rebookingId: 'reb-123',
                status: 'CONFIRMED',
                replacements: [],
            };
            (customerSupportService.staffRebookItinerary as jest.Mock).mockResolvedValue(mockRebookResult);

            const rebookReq = { bookingId: 101, replacements: [] };
            const result = await staffRebookItineraryAction(101, rebookReq, 'Weather cancellation');

            expect(result).toEqual(mockRebookResult);
            expect(customerSupportService.staffRebookItinerary).toHaveBeenCalledWith(
                101,
                rebookReq,
                'staff-user-1',
                'Weather cancellation'
            );
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                actorId: 'staff-user-1',
                actorUserId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
                action: 'BOOKING_REBOOK',
                targetType: 'Booking',
                targetId: '101',
                reason: 'Weather cancellation',
                afterState: { status: 'CONFIRMED' },
            }));
            expect(revalidatePath).toHaveBeenCalledWith('/admin/bookings');
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
            (customerSupportService.cancelAndRefundBooking as jest.Mock).mockResolvedValue({ id: 1, status: 'CANCELLED' });

            const result = await cancelBookingAction(1, 'Customer requested refund', '123456');

            expect(result).toEqual({ id: 1, status: 'CANCELLED' });
            expect(assertPrivilegedStaffOperation).toHaveBeenCalledWith({
                session: mockSession,
                permission: StaffPermission.BOOKINGS_REFUND,
                stepUpCode: '123456',
            });
            expect(customerSupportService.cancelAndRefundBooking).toHaveBeenCalledWith(1, 'staff-user-1', 'Customer requested refund');
            expect(recordStaffAudit).toHaveBeenCalledWith(expect.objectContaining({
                actorId: 'staff-user-1',
                actorUserId: 'staff-user-1',
                actorEmail: 'staff@example.com',
                actorRole: 'SUPPORT',
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
