/**
 * @jest-environment node
 */
import { searchBookingsAction, cancelBookingAction, addBookingNoteAction, resendEmailAction } from '@/app/admin/bookings/actions';
import { getServerSession } from 'next-auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/staffAuthorization', () => ({
    hasVerifiedStaffAccess: jest.fn(),
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

describe('Admin Bookings Server Actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects unauthorized access', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(false);

        await expect(searchBookingsAction({})).rejects.toThrow('Unauthorized');
        await expect(cancelBookingAction(1, 'reason')).rejects.toThrow('Unauthorized');
        await expect(addBookingNoteAction(1, 'note')).rejects.toThrow('Unauthorized');
        await expect(resendEmailAction(1)).rejects.toThrow('Unauthorized');
    });

    // In a real scenario we'd test the positive path here too, but since the actions
    // just delegate to customerSupportService which is already tested, verifying authorization
    // is the most critical check at this layer.
});
