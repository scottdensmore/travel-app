/**
 * @jest-environment node
 */
import {
    checkAccountDeletionEligibilityAction,
    deleteAccountAction,
} from '@/app/actions';
import { getServerSession } from 'next-auth';
import {
    checkAccountDeletionEligibility,
    deleteUserAccount,
    verifyUserPassword,
} from '@/lib/privacyService';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/privacyService', () => ({
    checkAccountDeletionEligibility: jest.fn(),
    deleteUserAccount: jest.fn(),
    verifyUserPassword: jest.fn(),
}));

describe('Privacy server actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('checkAccountDeletionEligibilityAction', () => {
        it('throws Unauthorized if no active user session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            await expect(checkAccountDeletionEligibilityAction()).rejects.toThrow('Unauthorized');
        });

        it('returns eligibility check result when authenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'usr-1' },
            });
            const mockEligibility = {
                eligible: true,
                reason: null,
                message: null,
                upcomingBookingsCount: 0,
            };
            (checkAccountDeletionEligibility as jest.Mock).mockResolvedValue(mockEligibility);

            const result = await checkAccountDeletionEligibilityAction();
            expect(result).toEqual({ ok: true, data: mockEligibility });
            expect(checkAccountDeletionEligibility).toHaveBeenCalledWith('usr-1');
        });
    });

    describe('deleteAccountAction', () => {
        it('throws Unauthorized if no active user session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);
            await expect(deleteAccountAction('mypassword')).rejects.toThrow('Unauthorized');
        });

        it('returns validation failure if password verification fails', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'usr-1' },
            });
            (verifyUserPassword as jest.Mock).mockResolvedValue({
                valid: false,
                message: 'The password you entered is incorrect.',
            });

            const result = await deleteAccountAction('badpassword');
            expect(result).toEqual({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'The password you entered is incorrect.',
                    fields: { password: ['The password you entered is incorrect.'] },
                },
            });
            expect(deleteUserAccount).not.toHaveBeenCalled();
        });

        it('returns validation failure if user has active upcoming flights', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'usr-1' },
            });
            (verifyUserPassword as jest.Mock).mockResolvedValue({ valid: true });
            (checkAccountDeletionEligibility as jest.Mock).mockResolvedValue({
                eligible: false,
                reason: 'UPCOMING_FLIGHTS',
                message: 'Account deletion cannot proceed because you have 1 upcoming active booking.',
                upcomingBookingsCount: 1,
            });

            const result = await deleteAccountAction('correctpassword');
            expect(result).toEqual({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Account deletion cannot proceed because you have 1 upcoming active booking.',
                    fields: {
                        _root: ['Account deletion cannot proceed because you have 1 upcoming active booking.'],
                    },
                },
            });
            expect(deleteUserAccount).not.toHaveBeenCalled();
        });

        it('successfully executes deletion when password is valid and no upcoming flights exist', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'usr-1' },
            });
            (verifyUserPassword as jest.Mock).mockResolvedValue({ valid: true });
            (checkAccountDeletionEligibility as jest.Mock).mockResolvedValue({
                eligible: true,
                reason: null,
                message: null,
                upcomingBookingsCount: 0,
            });
            (deleteUserAccount as jest.Mock).mockResolvedValue({
                success: true,
                anonymizedUserId: 'usr-1',
            });

            const result = await deleteAccountAction('correctpassword');
            expect(result).toEqual({ ok: true, data: { deleted: true } });
            expect(deleteUserAccount).toHaveBeenCalledWith('usr-1');
        });
    });
});
