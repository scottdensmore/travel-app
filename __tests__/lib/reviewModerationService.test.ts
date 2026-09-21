import {
    submitReview,
    updateReview,
    reportReview,
    moderateReview,
    DuplicateReviewError,
    ReviewNotFoundError,
    CannotReportOwnReviewError,
    DuplicateReportError,
    UnauthorizedError,
    ForbiddenStaffError,
    REPORT_AUTO_HIDE_THRESHOLD,
} from '@/lib/reviewModerationService';
import {
    reviewSchema,
    updateReviewSchema,
    reportReviewSchema,
    moderateReviewSchema,
} from '@/lib/validation';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        review: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        reviewReport: {
            findUnique: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        reviewModerationAudit: {
            create: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

describe('Review Moderation Service & Validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Validation Schemas', () => {
        describe('reviewSchema', () => {
            it('enforces min 10 characters and max 2000 characters for content', () => {
                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 5,
                    content: 'Short', // 5 chars
                }).success).toBe(false);

                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 5,
                    content: '123456789', // 9 chars
                }).success).toBe(false);

                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 5,
                    content: '1234567890', // 10 chars
                }).success).toBe(true);

                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 5,
                    content: 'x'.repeat(2000),
                }).success).toBe(true);

                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 5,
                    content: 'x'.repeat(2001),
                }).success).toBe(false);
            });

            it('enforces rating between 1 and 5', () => {
                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 0,
                    content: 'Valid content here',
                }).success).toBe(false);

                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 6,
                    content: 'Valid content here',
                }).success).toBe(false);

                expect(reviewSchema.safeParse({
                    cityGuideId: 1,
                    rating: 3,
                    content: 'Valid content here',
                }).success).toBe(true);
            });
        });

        describe('updateReviewSchema', () => {
            it('validates correct update review payload', () => {
                const valid = {
                    reviewId: 'rev-123',
                    rating: 4,
                    content: 'Updated content with at least 10 chars',
                };
                expect(updateReviewSchema.safeParse(valid).success).toBe(true);
            });

            it('rejects short content or invalid rating', () => {
                expect(updateReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    rating: 4,
                    content: 'Short',
                }).success).toBe(false);

                expect(updateReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    rating: 0,
                    content: 'Valid long content here',
                }).success).toBe(false);
            });
        });

        describe('reportReviewSchema', () => {
            it('validates allowed reasons and optional details', () => {
                expect(reportReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    reason: 'SPAM',
                }).success).toBe(true);

                expect(reportReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    reason: 'OFFENSIVE',
                    details: 'Contains unacceptable language',
                }).success).toBe(true);

                expect(reportReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    reason: 'INVALID_REASON',
                }).success).toBe(false);

                expect(reportReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    reason: 'HARASSMENT',
                    details: 'x'.repeat(501),
                }).success).toBe(false);
            });
        });

        describe('moderateReviewSchema', () => {
            it('validates allowed actions and optional reason', () => {
                expect(moderateReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    action: 'APPROVE',
                }).success).toBe(true);

                expect(moderateReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    action: 'HIDE',
                    reason: 'Pending further investigation',
                }).success).toBe(true);

                expect(moderateReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    action: 'INVALID_ACTION',
                }).success).toBe(false);

                expect(moderateReviewSchema.safeParse({
                    reviewId: 'rev-123',
                    action: 'DELETE',
                    reason: 'x'.repeat(501),
                }).success).toBe(false);
            });
        });
    });

    describe('Domain Error Classes', () => {
        it('instantiates all domain error classes with expected names and default messages', () => {
            const duplicateRev = new DuplicateReviewError();
            expect(duplicateRev.name).toBe('DuplicateReviewError');
            expect(duplicateRev.message).toContain('already reviewed');

            const notFound = new ReviewNotFoundError();
            expect(notFound.name).toBe('ReviewNotFoundError');
            expect(notFound.message).toContain('not found');

            const ownRev = new CannotReportOwnReviewError();
            expect(ownRev.name).toBe('CannotReportOwnReviewError');
            expect(ownRev.message).toContain('cannot report your own');

            const dupRep = new DuplicateReportError();
            expect(dupRep.name).toBe('DuplicateReportError');
            expect(dupRep.message).toContain('already reported');

            const unauth = new UnauthorizedError();
            expect(unauth.name).toBe('UnauthorizedError');

            const forbiddenStaff = new ForbiddenStaffError();
            expect(forbiddenStaff.name).toBe('ForbiddenStaffError');
            expect(forbiddenStaff.message).toContain('Staff access required');
        });
    });

    describe('submitReview', () => {
        it('rejects duplicate review for the same user and city guide', async () => {
            (prisma.review.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-rev' });

            await expect(
                submitReview('user-1', { cityGuideId: 10, rating: 5, content: 'A truly magnificent place.' })
            ).rejects.toThrow(DuplicateReviewError);
        });

        it('creates review with APPROVED status when no existing review exists', async () => {
            (prisma.review.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.review.create as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
                cityGuideId: 10,
                rating: 5,
                content: 'A truly magnificent place.',
                status: 'APPROVED',
            });

            const result = await submitReview('user-1', {
                cityGuideId: 10,
                rating: 5,
                content: 'A truly magnificent place.',
            });

            expect(result.id).toBe('rev-1');
            expect(result.status).toBe('APPROVED');
            expect(prisma.review.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        userId: 'user-1',
                        cityGuideId: 10,
                        rating: 5,
                        content: 'A truly magnificent place.',
                        status: 'APPROVED',
                    }),
                })
            );
        });
    });

    describe('updateReview', () => {
        it('throws ReviewNotFoundError when review does not exist', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

            await expect(
                updateReview('user-1', false, { reviewId: 'rev-none', rating: 4, content: 'Updated content here.' })
            ).rejects.toThrow(ReviewNotFoundError);
        });

        it('throws UnauthorizedError when non-author attempts to edit', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2', // different author
                status: 'APPROVED',
            });

            await expect(
                updateReview('user-1', false, { reviewId: 'rev-1', rating: 4, content: 'Updated content here.' })
            ).rejects.toThrow(UnauthorizedError);
        });

        it('allows staff to edit another user review', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2',
                status: 'APPROVED',
            });
            (prisma.review.update as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'APPROVED',
            });

            const updated = await updateReview('staff-user', true, {
                reviewId: 'rev-1',
                rating: 4,
                content: 'Staff edited review content.',
            });

            expect(updated.status).toBe('APPROVED');
            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'rev-1' },
                    data: expect.objectContaining({
                        rating: 4,
                        content: 'Staff edited review content.',
                        status: 'APPROVED',
                    }),
                })
            );
        });

        it('retains APPROVED status when an APPROVED review is updated', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
                status: 'APPROVED',
            });
            (prisma.review.update as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'APPROVED',
            });

            const updated = await updateReview('user-1', false, {
                reviewId: 'rev-1',
                rating: 4,
                content: 'Minor edit to my review content.',
            });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'APPROVED' }),
                })
            );
            expect(updated.status).toBe('APPROVED');
        });

        it('resets status to PENDING_MODERATION if previously HIDDEN', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
                status: 'HIDDEN',
            });
            (prisma.review.update as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'PENDING_MODERATION',
            });

            const updated = await updateReview('user-1', false, {
                reviewId: 'rev-1',
                rating: 5,
                content: 'Completely rewritten polite review.',
            });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'PENDING_MODERATION' }),
                })
            );
            expect(updated.status).toBe('PENDING_MODERATION');
        });
    });

    describe('reportReview', () => {
        it('throws ReviewNotFoundError when review is not found', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

            await expect(
                reportReview('user-1', { reviewId: 'rev-none', reason: 'SPAM' })
            ).rejects.toThrow(ReviewNotFoundError);
        });

        it('prevents authors from reporting their own review', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-1',
            });

            await expect(
                reportReview('user-1', { reviewId: 'rev-1', reason: 'SPAM' })
            ).rejects.toThrow(CannotReportOwnReviewError);
        });

        it('prevents duplicate reports by the same user', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2',
            });
            (prisma.reviewReport.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-rep' });

            await expect(
                reportReview('user-1', { reviewId: 'rev-1', reason: 'SPAM' })
            ).rejects.toThrow(DuplicateReportError);
        });

        it('records report without hiding when threshold is not reached', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2',
                status: 'APPROVED',
            });
            (prisma.reviewReport.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.reviewReport.create as jest.Mock).mockResolvedValue({ id: 'rep-1' });
            (prisma.reviewReport.count as jest.Mock).mockResolvedValue(1);

            const report = await reportReview('user-1', { reviewId: 'rev-1', reason: 'SPAM' });

            expect(prisma.review.update).not.toHaveBeenCalled();
            expect(prisma.reviewModerationAudit.create).not.toHaveBeenCalled();
            expect(report.id).toBe('rep-1');
        });

        it('auto-conceals to HIDDEN when pending reports reach threshold', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                userId: 'user-2',
                status: 'APPROVED',
            });
            (prisma.reviewReport.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.reviewReport.create as jest.Mock).mockResolvedValue({ id: 'rep-3' });
            (prisma.reviewReport.count as jest.Mock).mockResolvedValue(REPORT_AUTO_HIDE_THRESHOLD);

            await reportReview('user-1', { reviewId: 'rev-1', reason: 'OFFENSIVE' });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'rev-1' },
                    data: expect.objectContaining({ status: 'HIDDEN' }),
                })
            );
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: 'rev-1',
                        action: 'HIDE',
                        reason: expect.stringContaining('Automated threshold'),
                    }),
                })
            );
        });
    });

    describe('moderateReview', () => {
        it('throws ReviewNotFoundError when review does not exist', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

            await expect(
                moderateReview('mod-1', { reviewId: 'rev-none', action: 'APPROVE' })
            ).rejects.toThrow(ReviewNotFoundError);
        });

        it('approves review and resolves pending reports', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'PENDING_MODERATION',
            });

            await moderateReview('mod-1', {
                reviewId: 'rev-1',
                action: 'APPROVE',
                reason: 'Appropriate content.',
            });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'rev-1' },
                    data: expect.objectContaining({ status: 'APPROVED' }),
                })
            );
            expect(prisma.reviewReport.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { reviewId: 'rev-1', status: 'PENDING' },
                    data: expect.objectContaining({ status: 'RESOLVED' }),
                })
            );
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: 'rev-1',
                        moderatorId: 'mod-1',
                        action: 'APPROVE',
                        reason: 'Appropriate content.',
                    }),
                })
            );
        });

        it('hides review and resolves pending reports', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'APPROVED',
            });

            await moderateReview('mod-1', {
                reviewId: 'rev-1',
                action: 'HIDE',
                reason: 'Violates civility policy.',
            });

            expect(prisma.review.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'rev-1' },
                    data: expect.objectContaining({ status: 'HIDDEN' }),
                })
            );
            expect(prisma.reviewReport.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { reviewId: 'rev-1', status: 'PENDING' },
                    data: expect.objectContaining({ status: 'RESOLVED' }),
                })
            );
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: 'rev-1',
                        moderatorId: 'mod-1',
                        action: 'HIDE',
                        reason: 'Violates civility policy.',
                    }),
                })
            );
        });

        it('dismisses reports without altering review status', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                status: 'APPROVED',
            });

            await moderateReview('mod-1', {
                reviewId: 'rev-1',
                action: 'DISMISS_REPORTS',
                reason: 'Reports deemed bad faith / invalid.',
            });

            expect(prisma.review.update).not.toHaveBeenCalled();
            expect(prisma.reviewReport.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { reviewId: 'rev-1', status: 'PENDING' },
                    data: expect.objectContaining({ status: 'DISMISSED' }),
                })
            );
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: 'rev-1',
                        moderatorId: 'mod-1',
                        action: 'DISMISS_REPORTS',
                    }),
                })
            );
        });

        it('deletes review and captures metadata in audit record', async () => {
            (prisma.review.findUnique as jest.Mock).mockResolvedValue({
                id: 'rev-1',
                content: 'Violating content.',
                rating: 1,
                cityGuideId: 5,
                userId: 'spammer-1',
            });

            await moderateReview('mod-1', {
                reviewId: 'rev-1',
                action: 'DELETE',
                reason: 'Severe TOS violation.',
            });

            expect(prisma.review.delete).toHaveBeenCalledWith({ where: { id: 'rev-1' } });
            expect(prisma.reviewModerationAudit.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        reviewId: null,
                        action: 'DELETE',
                        metadata: expect.objectContaining({
                            content: 'Violating content.',
                        }),
                    }),
                })
            );
        });
    });
});
