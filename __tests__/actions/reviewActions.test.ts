import {
    submitCityGuideReviewAction,
    updateCityGuideReviewAction,
    reportCityGuideReviewAction,
    moderateReviewAction,
    deleteReviewAction,
} from '@/app/actions/reviewActions';
import * as moderationService from '@/lib/reviewModerationService';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/reviewModerationService', () => {
    const actual = jest.requireActual('@/lib/reviewModerationService');
    return {
        ...actual,
        submitReview: jest.fn(),
        updateReview: jest.fn(),
        reportReview: jest.fn(),
        moderateReview: jest.fn(),
    };
});

jest.mock('@/lib/prisma', () => ({
    prisma: {
        review: {
            findUnique: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

describe('Review Server Actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('submitCityGuideReviewAction', () => {
        it('returns validation failure when unauthenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await submitCityGuideReviewAction(1, 5, 'Great city to visit!');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/sign in/i);
            }
        });

        it('returns validation failure when input is invalid', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });

            // Content too short (< 10 chars)
            const result = await submitCityGuideReviewAction(1, 5, 'Short');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.fields).toHaveProperty('content');
            }
        });

        it('submits review successfully when authenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (moderationService.submitReview as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                rating: 5,
                content: 'Great city to visit!',
            });

            const result = await submitCityGuideReviewAction(1, 5, 'Great city to visit!');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.id).toBe('rev-1');
            }
            expect(moderationService.submitReview).toHaveBeenCalledWith('user-1', {
                cityGuideId: 1,
                rating: 5,
                content: 'Great city to visit!',
            });
            expect(revalidatePath).toHaveBeenCalledWith('/travelguide');
            expect(revalidatePath).toHaveBeenCalledWith('/profile');
        });

        it('catches DuplicateReviewError and returns validation failure', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (moderationService.submitReview as jest.Mock).mockRejectedValue(
                new moderationService.DuplicateReviewError()
            );

            const result = await submitCityGuideReviewAction(1, 5, 'Great city to visit!');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/already reviewed/i);
            }
        });
    });

    describe('updateCityGuideReviewAction', () => {
        it('returns validation failure when unauthenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await updateCityGuideReviewAction('rev-1', 4, 'Updated review content here.');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/sign in/i);
            }
        });

        it('returns validation failure when input is invalid', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });

            const result = await updateCityGuideReviewAction('rev-1', 6, 'Updated review content here.');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.fields).toHaveProperty('rating');
            }
        });

        it('updates review successfully when authenticated as author', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-1', role: 'TRAVELER' },
            });
            (moderationService.updateReview as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                rating: 4,
                content: 'Updated review content here.',
            });

            const result = await updateCityGuideReviewAction('rev-1', 4, 'Updated review content here.');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.id).toBe('rev-1');
            }
            expect(moderationService.updateReview).toHaveBeenCalledWith('user-1', false, {
                reviewId: 'rev-1',
                rating: 4,
                content: 'Updated review content here.',
            });
            expect(revalidatePath).toHaveBeenCalledWith('/travelguide');
            expect(revalidatePath).toHaveBeenCalledWith('/profile');
        });

        it('passes isStaff true when authenticated as staff', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });
            (moderationService.updateReview as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                rating: 4,
                content: 'Staff edited review content.',
            });

            const result = await updateCityGuideReviewAction('rev-1', 4, 'Staff edited review content.');
            expect(result.ok).toBe(true);
            expect(moderationService.updateReview).toHaveBeenCalledWith('staff-1', true, {
                reviewId: 'rev-1',
                rating: 4,
                content: 'Staff edited review content.',
            });
        });

        it('catches UnauthorizedError and returns validation failure', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-1', role: 'TRAVELER' },
            });
            (moderationService.updateReview as jest.Mock).mockRejectedValue(
                new moderationService.UnauthorizedError()
            );

            const result = await updateCityGuideReviewAction('rev-1', 4, 'Updated review content here.');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/unauthorized/i);
            }
        });
    });

    describe('reportCityGuideReviewAction', () => {
        it('returns validation failure when unauthenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await reportCityGuideReviewAction('rev-1', 'SPAM');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/sign in/i);
            }
        });

        it('returns validation failure when reason is invalid', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });

            const result = await reportCityGuideReviewAction('rev-1', 'INVALID_REASON' as never);
            expect(result.ok).toBe(false);
        });

        it('reports review successfully when authenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (moderationService.reportReview as jest.Mock).mockResolvedValue({
                id: 'report-123',
                reviewId: 'rev-1',
            });

            const result = await reportCityGuideReviewAction('rev-1', 'SPAM', 'This is an ad');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.reportId).toBe('report-123');
            }
            expect(moderationService.reportReview).toHaveBeenCalledWith('user-1', {
                reviewId: 'rev-1',
                reason: 'SPAM',
                details: 'This is an ad',
            });
            expect(revalidatePath).toHaveBeenCalledWith('/travelguide');
            expect(revalidatePath).toHaveBeenCalledWith('/admin/reviews');
        });

        it('catches CannotReportOwnReviewError and returns validation failure', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
            (moderationService.reportReview as jest.Mock).mockRejectedValue(
                new moderationService.CannotReportOwnReviewError()
            );

            const result = await reportCityGuideReviewAction('rev-1', 'SPAM');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/cannot report your own review/i);
            }
        });
    });

    describe('moderateReviewAction', () => {
        it('returns unauthorized error for unauthenticated user', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await moderateReviewAction('rev-1', 'APPROVE');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/staff access required/i);
            }
        });

        it('returns unauthorized error for non-staff users', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-1', role: 'TRAVELER' },
            });

            const result = await moderateReviewAction('rev-1', 'APPROVE');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/staff access required/i);
            }
        });

        it('returns unauthorized error for staff without verified MFA', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: false },
            });

            const result = await moderateReviewAction('rev-1', 'APPROVE');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/staff access required/i);
            }
        });

        it('executes moderation for verified staff members', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', mfaVerified: true },
            });
            (moderationService.moderateReview as jest.Mock).mockResolvedValue(undefined);

            const result = await moderateReviewAction('rev-1', 'APPROVE', 'Looks good');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.success).toBe(true);
            }
            expect(moderationService.moderateReview).toHaveBeenCalledWith('staff-1', {
                reviewId: 'rev-1',
                action: 'APPROVE',
                reason: 'Looks good',
            });
            expect(revalidatePath).toHaveBeenCalledWith('/admin/reviews');
            expect(revalidatePath).toHaveBeenCalledWith('/travelguide');
            expect(revalidatePath).toHaveBeenCalledWith('/profile');
        });

        it('returns validation failure for invalid action', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });

            const result = await moderateReviewAction('rev-1', 'INVALID_ACTION' as never);
            expect(result.ok).toBe(false);
        });

        it('catches ReviewNotFoundError and returns validation failure', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });
            (moderationService.moderateReview as jest.Mock).mockRejectedValue(
                new moderationService.ReviewNotFoundError()
            );

            const result = await moderateReviewAction('rev-1', 'APPROVE');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/review not found/i);
            }
        });
    });

    describe('deleteReviewAction', () => {
        it('returns validation failure when unauthenticated', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await deleteReviewAction('rev-1');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/sign in/i);
            }
        });

        it('returns validation failure when review is not found', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-1', role: 'TRAVELER' },
            });
            (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await deleteReviewAction('rev-1');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/review not found/i);
            }
        });

        it('returns unauthorized failure when user is neither author nor staff', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-2', role: 'TRAVELER' },
            });
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
            });

            const result = await deleteReviewAction('rev-1');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toMatch(/unauthorized/i);
            }
            expect(prisma.review.delete).not.toHaveBeenCalled();
            expect(moderationService.moderateReview).not.toHaveBeenCalled();
        });

        it('allows author to delete their own review directly', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'user-1', role: 'TRAVELER' },
            });
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
            });
            (prisma.review.delete as jest.Mock).mockResolvedValue({ id: 'rev-1' });

            const result = await deleteReviewAction('rev-1');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.id).toBe('rev-1');
            }
            expect(prisma.review.delete).toHaveBeenCalledWith({ where: { id: 'rev-1' } });
            expect(moderationService.moderateReview).not.toHaveBeenCalled();
            expect(revalidatePath).toHaveBeenCalledWith('/travelguide');
            expect(revalidatePath).toHaveBeenCalledWith('/profile');
        });

        it('delegates to moderateReview with DELETE action when staff deletes', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
            });
            (moderationService.moderateReview as jest.Mock).mockResolvedValue(undefined);

            const result = await deleteReviewAction('rev-1');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.id).toBe('rev-1');
            }
            expect(moderationService.moderateReview).toHaveBeenCalledWith('staff-1', {
                reviewId: 'rev-1',
                action: 'DELETE',
            });
            expect(prisma.review.delete).not.toHaveBeenCalled();
            expect(revalidatePath).toHaveBeenCalledWith('/travelguide');
            expect(revalidatePath).toHaveBeenCalledWith('/profile');
            expect(revalidatePath).toHaveBeenCalledWith('/admin/reviews');
        });
    });
});
