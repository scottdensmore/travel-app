'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { assertPrivilegedStaffOperation } from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import * as customerSupportService from '@/lib/customerSupportService';
import {
    SupportSearchQuery,
    SupportSearchResult,
    BookingNoteWithActor,
    RebookItineraryRequest,
    RebookResult,
} from '@/lib/customerSupportService';
import { Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';

async function requireStaffAuth(permission: StaffPermission) {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, permission) || !session?.user?.id) {
        throw new Error('Unauthorized');
    }
    return { session, user: session.user };
}

export async function searchBookingsAction(query: SupportSearchQuery): Promise<SupportSearchResult> {
    await requireStaffAuth(StaffPermission.BOOKINGS_READ);
    return customerSupportService.searchBookings(query);
}

export async function getBookingNotesAction(bookingId: number): Promise<BookingNoteWithActor[]> {
    await requireStaffAuth(StaffPermission.BOOKINGS_READ);
    return customerSupportService.getBookingNotes(bookingId);
}

export async function addBookingNoteAction(bookingId: number, note: string): Promise<void> {
    const { user } = await requireStaffAuth(StaffPermission.BOOKINGS_WRITE_NOTES);
    if (!note?.trim()) {
        throw new Error('Note text cannot be empty.');
    }

    await customerSupportService.addInternalNote(bookingId, user.id, note.trim());

    await recordStaffAudit({
        actorId: user.id,
        actorUserId: user.id,
        actorEmail: user.email || 'staff@mona-airways.internal',
        actorRole: (user.role as Role) || Role.SUPPORT,
        action: 'BOOKING_ADD_NOTE',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Support staff added internal booking note',
        afterState: { noteSnippet: note.trim().slice(0, 100), noteLength: note.trim().length },
    });

    revalidatePath('/admin/bookings');
}

export async function resendEmailAction(bookingId: number): Promise<{ success: true; sentTo: string }> {
    const { user } = await requireStaffAuth(StaffPermission.NOTIFICATIONS_RESEND);
    const result = await customerSupportService.resendConfirmationEmail(bookingId);

    await recordStaffAudit({
        actorId: user.id,
        actorUserId: user.id,
        actorEmail: user.email || 'staff@mona-airways.internal',
        actorRole: (user.role as Role) || Role.SUPPORT,
        action: 'BOOKING_RESEND_CONFIRMATION',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Staff resent booking confirmation email',
        afterState: { sentTo: result.sentTo },
    });

    return result;
}

export const resendConfirmationEmailAction = resendEmailAction;

export async function resendReceiptEmailAction(bookingId: number): Promise<{ success: true; sentTo: string }> {
    const { user } = await requireStaffAuth(StaffPermission.NOTIFICATIONS_RESEND);
    const result = await customerSupportService.resendReceiptEmail(bookingId);

    await recordStaffAudit({
        actorId: user.id,
        actorUserId: user.id,
        actorEmail: user.email || 'staff@mona-airways.internal',
        actorRole: (user.role as Role) || Role.SUPPORT,
        action: 'BOOKING_RESEND_RECEIPT',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason: 'Staff resent tax invoice & receipt email',
        afterState: { sentTo: result.sentTo },
    });

    return result;
}

export async function staffChangeBookingSeatsAction(
    bookingId: number,
    seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>,
    reason: string
): Promise<void> {
    const { user } = await requireStaffAuth(StaffPermission.BOOKINGS_WRITE);

    await customerSupportService.staffChangeBookingSeats(bookingId, seatChanges, user.id, reason);

    await recordStaffAudit({
        actorId: user.id,
        actorUserId: user.id,
        actorEmail: user.email || 'staff@mona-airways.internal',
        actorRole: (user.role as Role) || Role.SUPPORT,
        action: 'BOOKING_SEAT_CHANGE',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        afterState: { seatChanges: seatChanges as unknown as Record<string, unknown> },
    });

    revalidatePath('/admin/bookings');
}

export async function staffRebookItineraryAction(
    bookingId: number,
    request: RebookItineraryRequest,
    reason: string
): Promise<RebookResult> {
    const { user } = await requireStaffAuth(StaffPermission.BOOKINGS_WRITE);

    const result = await customerSupportService.staffRebookItinerary(bookingId, request, user.id, reason);

    await recordStaffAudit({
        actorId: user.id,
        actorUserId: user.id,
        actorEmail: user.email || 'staff@mona-airways.internal',
        actorRole: (user.role as Role) || Role.SUPPORT,
        action: 'BOOKING_REBOOK',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        afterState: { status: result.status },
    });

    revalidatePath('/admin/bookings');
    return result;
}

export async function cancelBookingAction(
    bookingId: number,
    reason: string,
    stepUpCode?: string
): Promise<unknown> {
    const session = await getServerSession(authOptions);
    const actor = await assertPrivilegedStaffOperation({
        session,
        permission: StaffPermission.BOOKINGS_REFUND,
        stepUpCode,
    });

    const result = await customerSupportService.cancelAndRefundBooking(bookingId, actor.userId, reason);

    await recordStaffAudit({
        actorId: actor.actorId || actor.userId,
        actorUserId: actor.userId,
        actorEmail: actor.actorEmail || session?.user?.email || 'staff@mona-airways.internal',
        actorRole: (actor.actorRole as Role) || (session?.user?.role as Role) || Role.SUPPORT,
        action: 'BOOKING_CANCEL_REFUND',
        targetType: 'Booking',
        targetId: String(bookingId),
        reason,
        beforeState: { status: 'CONFIRMED' },
        afterState: { status: 'CANCELLED' },
    });

    revalidatePath('/admin/bookings');
    return result;
}
