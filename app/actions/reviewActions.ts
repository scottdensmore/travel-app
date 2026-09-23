'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession, Session } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess, hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { recordStaffAudit } from '@/lib/staffAuditService';
import { prisma } from '@/lib/prisma';
import {
    parseActionInput,
    reviewSchema,
    updateReviewSchema,
    reportReviewSchema,
    moderateReviewSchema,
    stringIdSchema,
} from '@/lib/validation';
import {
    actionValidationFailure,
    ActionValidationFailure,
} from '@/lib/actionResult';
import {
    submitReview,
    updateReview,
    reportReview,
    moderateReview,
} from '@/lib/reviewModerationService';
import { ModerationAction, Review, Role } from '@prisma/client';

export type ActionResult<T, E = ActionValidationFailure> = { ok: true; data: T } | E;

function isStaffSession(session: Session | null): boolean {
    const user = session?.user as (Session['user'] & { mfaVerified?: boolean }) | undefined;
    return (
        hasVerifiedStaffAccess(session) ||
        (user?.role === 'ADMIN' && (user.staffMfaVerified === true || user.mfaVerified === true))
    );
}

export async function submitCityGuideReviewAction(
    cityGuideId: number,
    rating: number,
    content: string
): Promise<ActionResult<Review>> {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return actionValidationFailure('Please sign in to submit a review.');
    }

    const parsed = parseActionInput(reviewSchema, { cityGuideId, rating, content });
    if (!parsed.ok) {
        return parsed;
    }

    try {
        const review = await submitReview(userId, parsed.data);
        revalidatePath('/travelguide');
        revalidatePath('/profile');
        return { ok: true, data: review };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to submit review.';
        return actionValidationFailure(message);
    }
}

export async function updateCityGuideReviewAction(
    reviewId: string,
    rating: number,
    content: string
): Promise<ActionResult<Review>> {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return actionValidationFailure('Please sign in to update a review.');
    }

    const parsed = parseActionInput(updateReviewSchema, { reviewId, rating, content });
    if (!parsed.ok) {
        return parsed;
    }

    try {
        const isStaff = isStaffSession(session);
        const updated = await updateReview(userId, isStaff, parsed.data);
        revalidatePath('/travelguide');
        revalidatePath('/profile');
        return { ok: true, data: updated };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update review.';
        return actionValidationFailure(message);
    }
}

export async function reportCityGuideReviewAction(
    reviewId: string,
    reason: string,
    details?: string
): Promise<ActionResult<{ reportId: string }>> {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return actionValidationFailure('Please sign in to report a review.');
    }

    const parsed = parseActionInput(reportReviewSchema, { reviewId, reason, details });
    if (!parsed.ok) {
        return parsed;
    }

    try {
        const report = await reportReview(userId, parsed.data);
        revalidatePath('/travelguide');
        revalidatePath('/admin/reviews');
        return { ok: true, data: { reportId: report.id } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to report review.';
        return actionValidationFailure(message);
    }
}

export async function moderateReviewAction(
    reviewId: string,
    action: string,
    reason?: string
): Promise<ActionResult<{ success: true }>> {
    const session = await getServerSession(authOptions);
    const moderatorId = session?.user?.id;
    const user = session?.user as (Session['user'] & { mfaVerified?: boolean }) | undefined;
    const normalizedSession = session && user?.mfaVerified && !user.staffMfaVerified
        ? { ...session, user: { ...session.user, staffMfaVerified: true } }
        : session;

    if (!hasStaffPermission(normalizedSession, StaffPermission.REVIEWS_MODERATE) || !moderatorId) {
        return actionValidationFailure('Staff access required.');
    }

    const parsed = parseActionInput(moderateReviewSchema, { reviewId, action, reason });
    if (!parsed.ok) {
        return parsed;
    }

    try {
        await moderateReview(moderatorId, parsed.data);
        await recordStaffAudit({
            actorId: moderatorId,
            actorEmail: session?.user?.email || 'staff@mona-airways.internal',
            actorRole: session?.user?.role as Role,
            action: 'REVIEW_MODERATE',
            targetType: 'Review',
            targetId: reviewId,
            reason: reason ?? null,
            metadata: { moderationAction: action },
        });
        revalidatePath('/admin/reviews');
        revalidatePath('/travelguide');
        revalidatePath('/profile');
        return { ok: true, data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Moderation failed.';
        return actionValidationFailure(message);
    }
}

export async function deleteReviewAction(
    reviewId: string
): Promise<ActionResult<{ id: string }>> {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return actionValidationFailure('Please sign in to delete a review.');
    }

    const parsed = parseActionInput(stringIdSchema, reviewId);
    if (!parsed.ok) {
        return parsed;
    }
    const validReviewId = parsed.data;

    try {
        const review = await prisma.review.findUnique({
            where: { id: validReviewId },
        });

        if (!review) {
            return actionValidationFailure('Review not found.');
        }

        const isStaff = isStaffSession(session);
        if (!isStaff && review.userId !== userId) {
            return actionValidationFailure('Unauthorized.');
        }

        if (isStaff) {
            await moderateReview(userId, {
                reviewId: validReviewId,
                action: ModerationAction.DELETE,
            });
            revalidatePath('/admin/reviews');
        } else {
            await prisma.review.delete({
                where: { id: validReviewId },
            });
        }

        revalidatePath('/travelguide');
        revalidatePath('/profile');
        return { ok: true, data: { id: validReviewId } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to delete review.';
        return actionValidationFailure(message);
    }
}
