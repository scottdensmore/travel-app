'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';
import * as customerSupportService from '@/lib/customerSupportService';
import { BookingStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';

async function requireAdminAuth() {
    const session = await getServerSession(authOptions);
    if (!session || !hasVerifiedStaffAccess(session)) {
        throw new Error('Unauthorized');
    }
    return session.user.id;
}

export async function searchBookingsAction(query: { reference?: string; emailOrName?: string; flightNumber?: string; status?: BookingStatus }) {
    await requireAdminAuth();
    return customerSupportService.searchBookings(query);
}

export async function cancelBookingAction(bookingId: number, reason: string) {
    const actorUserId = await requireAdminAuth();
    await customerSupportService.cancelAndRefundBooking(bookingId, actorUserId, reason);
    revalidatePath('/admin/bookings');
}

export async function addBookingNoteAction(bookingId: number, note: string) {
    const actorUserId = await requireAdminAuth();
    await customerSupportService.addInternalNote(bookingId, actorUserId, note);
    revalidatePath('/admin/bookings');
}

export async function resendEmailAction(bookingId: number) {
    await requireAdminAuth();
    await customerSupportService.resendConfirmationEmail(bookingId);
}
