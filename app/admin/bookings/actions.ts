'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { assertPrivilegedStaffOperation } from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import * as customerSupportService from '@/lib/customerSupportService';
import { BookingStatus, Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';

export async function searchBookingsAction(query: { reference?: string; emailOrName?: string; flightNumber?: string; status?: BookingStatus }) {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.BOOKINGS_READ)) {
        throw new Error('Unauthorized');
    }
    return customerSupportService.searchBookings(query);
}

export async function cancelBookingAction(bookingId: number, reason: string, stepUpCode?: string) {
    const session = await getServerSession(authOptions);
    const actor = await assertPrivilegedStaffOperation({
        session,
        permission: StaffPermission.BOOKINGS_REFUND,
        stepUpCode,
    });
    await customerSupportService.cancelAndRefundBooking(bookingId, actor.userId, reason);
    await recordStaffAudit({
        actorId: actor.actorId,
        actorUserId: actor.userId,
        actorEmail: actor.actorEmail || 'staff@mona-airways.internal',
        actorRole: actor.actorRole,
        action: 'BOOKING_CANCEL_REFUND',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        beforeState: { status: 'CONFIRMED' },
        afterState: { status: 'CANCELLED' },
    });
    revalidatePath('/admin/bookings');
}

export async function addBookingNoteAction(bookingId: number, note: string) {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.BOOKINGS_WRITE_NOTES) || !session?.user?.id) {
        throw new Error('Unauthorized');
    }
    const actorUserId = session.user.id;
    await customerSupportService.addInternalNote(bookingId, actorUserId, note);
    await recordStaffAudit({
        actorId: actorUserId,
        actorUserId,
        actorEmail: session.user.email || 'staff@mona-airways.internal',
        actorRole: session.user.role as Role,
        action: 'BOOKING_ADD_NOTE',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Support staff added internal booking note',
    });
    revalidatePath('/admin/bookings');
}

export async function resendEmailAction(bookingId: number) {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.NOTIFICATIONS_RESEND) || !session?.user?.id) {
        throw new Error('Unauthorized');
    }
    await customerSupportService.resendConfirmationEmail(bookingId);
    await recordStaffAudit({
        actorId: session.user.id,
        actorUserId: session.user.id,
        actorEmail: session.user.email || 'staff@mona-airways.internal',
        actorRole: session.user.role as Role,
        action: 'BOOKING_RESEND_EMAIL',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Staff resent booking confirmation email',
    });
}
