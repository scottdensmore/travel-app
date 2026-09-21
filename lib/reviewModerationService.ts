import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
    Prisma,
    ReviewStatus,
    ReviewReportReason,
    ReportStatus,
    ModerationAction,
} from '@prisma/client';

export const REPORT_AUTO_HIDE_THRESHOLD = 3;

export class DuplicateReviewError extends Error {
    constructor(message = 'You have already reviewed this city guide. You can update your existing review.') {
        super(message);
        this.name = 'DuplicateReviewError';
    }
}

export class ReviewNotFoundError extends Error {
    constructor(message = 'Review not found.') {
        super(message);
        this.name = 'ReviewNotFoundError';
    }
}

export class CannotReportOwnReviewError extends Error {
    constructor(message = 'You cannot report your own review.') {
        super(message);
        this.name = 'CannotReportOwnReviewError';
    }
}

export class DuplicateReportError extends Error {
    constructor(message = 'You have already reported this review.') {
        super(message);
        this.name = 'DuplicateReportError';
    }
}

export class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized.') {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

export class ForbiddenStaffError extends Error {
    constructor(message = 'Staff access required.') {
        super(message);
        this.name = 'ForbiddenStaffError';
    }
}

export interface SubmitReviewInput {
    cityGuideId: number;
    rating: number;
    content: string;
}

export interface UpdateReviewInput {
    reviewId: string;
    rating: number;
    content: string;
}

export interface ReportReviewInput {
    reviewId: string;
    reason: ReviewReportReason;
    details?: string;
}

export interface ModerateReviewInput {
    reviewId: string;
    action: ModerationAction;
    reason?: string;
}

export async function submitReview(userId: string, data: SubmitReviewInput) {
    const existing = await prisma.review.findFirst({
        where: {
            userId,
            cityGuideId: data.cityGuideId,
        },
    });

    if (existing) {
        throw new DuplicateReviewError();
    }

    try {
        const review = await prisma.review.create({
            data: {
                userId,
                cityGuideId: data.cityGuideId,
                rating: data.rating,
                content: data.content,
                status: ReviewStatus.APPROVED,
            },
        });

        logger.info('Review submitted', {
            reviewId: review.id,
            userId,
            cityGuideId: data.cityGuideId,
            rating: data.rating,
            status: review.status,
        });

        return review;
    } catch (error: unknown) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
            (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002')
        ) {
            throw new DuplicateReviewError();
        }
        throw error;
    }
}

export async function updateReview(
    userId: string,
    isStaff: boolean,
    data: UpdateReviewInput
) {
    const review = await prisma.review.findUnique({
        where: { id: data.reviewId },
    });

    if (!review) {
        throw new ReviewNotFoundError();
    }

    if (!isStaff && review.userId !== userId) {
        throw new UnauthorizedError();
    }

    const nextStatus = review.status === ReviewStatus.HIDDEN
        ? ReviewStatus.PENDING_MODERATION
        : review.status;

    const updated = await prisma.review.update({
        where: { id: data.reviewId },
        data: {
            rating: data.rating,
            content: data.content,
            status: nextStatus,
            updatedAt: new Date(),
        },
    });

    logger.info('Review updated', {
        reviewId: data.reviewId,
        userId,
        isStaff,
        previousStatus: review.status,
        newStatus: updated.status,
    });

    return updated;
}

export async function reportReview(reporterId: string, data: ReportReviewInput) {
    const review = await prisma.review.findUnique({
        where: { id: data.reviewId },
    });

    if (!review) {
        throw new ReviewNotFoundError();
    }

    if (review.userId === reporterId) {
        throw new CannotReportOwnReviewError();
    }

    const existingReport = await prisma.reviewReport.findUnique({
        where: {
            reviewId_reporterId: {
                reviewId: data.reviewId,
                reporterId,
            },
        },
    });

    if (existingReport) {
        throw new DuplicateReportError();
    }

    return await prisma.$transaction(async (tx) => {
        let report;
        try {
            report = await tx.reviewReport.create({
                data: {
                    reviewId: data.reviewId,
                    reporterId,
                    reason: data.reason,
                    details: data.details,
                    status: ReportStatus.PENDING,
                },
            });
        } catch (error: unknown) {
            if (
                (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
                (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002')
            ) {
                throw new DuplicateReportError();
            }
            throw error;
        }

        const pendingReportsCount = await tx.reviewReport.count({
            where: {
                reviewId: data.reviewId,
                status: ReportStatus.PENDING,
            },
        });

        let autoHidden = false;
        if (pendingReportsCount >= REPORT_AUTO_HIDE_THRESHOLD && review.status === ReviewStatus.APPROVED) {
            await tx.review.update({
                where: { id: data.reviewId },
                data: { status: ReviewStatus.HIDDEN },
            });

            await tx.reviewModerationAudit.create({
                data: {
                    reviewId: data.reviewId,
                    moderatorId: reporterId,
                    action: ModerationAction.HIDE,
                    reason: `Automated threshold: ${REPORT_AUTO_HIDE_THRESHOLD}+ user reports`,
                    metadata: {
                        pendingReports: pendingReportsCount,
                        triggeredByReporterId: reporterId,
                    },
                },
            });

            autoHidden = true;
        }

        logger.info('Review reported', {
            reportId: report.id,
            reviewId: data.reviewId,
            reporterId,
            reason: data.reason,
            autoHidden,
            pendingReportsCount,
        });

        return report;
    });
}

export async function moderateReview(moderatorId: string, data: ModerateReviewInput) {
    const review = await prisma.review.findUnique({
        where: { id: data.reviewId },
    });

    if (!review) {
        throw new ReviewNotFoundError();
    }

    return await prisma.$transaction(async (tx) => {
        const now = new Date();

        if (data.action === ModerationAction.APPROVE) {
            await tx.review.update({
                where: { id: data.reviewId },
                data: { status: ReviewStatus.APPROVED },
            });
            await tx.reviewReport.updateMany({
                where: { reviewId: data.reviewId, status: ReportStatus.PENDING },
                data: { status: ReportStatus.RESOLVED, resolvedAt: now },
            });
        } else if (data.action === ModerationAction.HIDE) {
            await tx.review.update({
                where: { id: data.reviewId },
                data: { status: ReviewStatus.HIDDEN },
            });
            await tx.reviewReport.updateMany({
                where: { reviewId: data.reviewId, status: ReportStatus.PENDING },
                data: { status: ReportStatus.RESOLVED, resolvedAt: now },
            });
        } else if (data.action === ModerationAction.DISMISS_REPORTS) {
            await tx.reviewReport.updateMany({
                where: { reviewId: data.reviewId, status: ReportStatus.PENDING },
                data: { status: ReportStatus.DISMISSED, resolvedAt: now },
            });
        } else if (data.action === ModerationAction.DELETE) {
            await tx.review.delete({
                where: { id: data.reviewId },
            });
        }

        const metadata = data.action === ModerationAction.DELETE
            ? {
                content: review.content,
                rating: review.rating,
                cityGuideId: review.cityGuideId,
                authorId: review.userId,
            }
            : undefined;

        const audit = await tx.reviewModerationAudit.create({
            data: {
                reviewId: data.action === ModerationAction.DELETE ? null : data.reviewId,
                moderatorId,
                action: data.action,
                reason: data.reason,
                metadata,
            },
        });

        logger.info('Review moderated', {
            moderatorId,
            reviewId: data.reviewId,
            action: data.action,
            reason: data.reason,
            auditId: audit?.id,
        });

        return audit;
    });
}
