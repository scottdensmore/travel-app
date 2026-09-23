import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import BookingManagementPortal from '@/components/admin/BookingManagementPortal';
import {
    searchBookingsAction,
    cancelBookingAction,
    addBookingNoteAction,
    getBookingNotesAction,
    resendEmailAction,
    resendReceiptEmailAction,
    staffChangeBookingSeatsAction,
    staffRebookItineraryAction,
} from './actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminBookingsPage() {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.BOOKINGS_READ)) {
        redirect(session ? '/admin' : '/login');
        return null;
    }

    const initialData = await searchBookingsAction({});

    return (
        <div className="page-container admin p-8" style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white">Customer Support Portal</h1>
                <Link href="/admin" className="text-purple-400 font-semibold hover:underline">← Back to Dashboard</Link>
            </div>
            
            <BookingManagementPortal 
                initialData={initialData}
                searchAction={searchBookingsAction}
                cancelAction={cancelBookingAction}
                addNoteAction={addBookingNoteAction}
                getNotesAction={getBookingNotesAction}
                emailAction={resendEmailAction}
                receiptAction={resendReceiptEmailAction}
                seatChangeAction={staffChangeBookingSeatsAction}
                rebookAction={staffRebookItineraryAction}
            />
        </div>
    );
}
