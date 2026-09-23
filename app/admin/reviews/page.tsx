import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { hasStaffPermission } from '@/lib/staffAuthorization';
import { StaffPermission } from '@/lib/staffPermissions';
import { prisma } from '@/lib/prisma';
import ReviewModerationClient from '@/components/admin/ReviewModerationClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage() {
    const session = await getServerSession(authOptions);
    if (!hasStaffPermission(session, StaffPermission.REVIEWS_MODERATE)) {
        redirect(session ? '/admin' : '/login');
        return null;
    }

    const reviews = await prisma.review.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            cityGuide: {
                select: {
                    id: true,
                    city: true,
                    country: true,
                },
            },
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            reports: {
                orderBy: { createdAt: 'desc' },
                include: {
                    reporter: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
            },
        },
    });

    const audits = await prisma.reviewModerationAudit.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
            moderator: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            review: {
                select: {
                    id: true,
                    cityGuide: {
                        select: {
                            city: true,
                            country: true,
                        },
                    },
                },
            },
        },
    });

    return (
        <div
            className="page-container admin p-8"
            style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '2rem' }}
        >
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white">Review Moderation Queue</h1>
                <Link href="/admin" className="text-purple-400 font-semibold hover:underline">
                    ← Back to Dashboard
                </Link>
            </div>

            <ReviewModerationClient
                initialReviews={reviews}
                initialAudits={audits}
            />
        </div>
    );
}
