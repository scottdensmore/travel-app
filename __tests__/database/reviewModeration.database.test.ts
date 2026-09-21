/** @jest-environment node */
import { prisma } from '@/lib/prisma';

describe('Review Moderation Database Schema', () => {
    const testEmail = `test-mod-${Date.now()}@example.com`;
    let testUserId: string;
    let cityGuideId: number;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: testEmail,
                name: 'Test Reviewer',
            },
        });
        testUserId = user.id;

        const city = await prisma.cityGuide.create({
            data: {
                city: `TestCity-${Date.now()}`,
                country: 'TestCountry',
                description: 'A test city for review moderation tests',
                highlights: ['Park', 'Museum'],
            },
        });
        cityGuideId = city.id;
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { email: testEmail } });
        if (cityGuideId) {
            await prisma.cityGuide.deleteMany({ where: { id: cityGuideId } });
        }
    });

    it('creates review with default APPROVED status and updatedAt timestamp', async () => {
        const review = await prisma.review.create({
            data: {
                userId: testUserId,
                cityGuideId,
                rating: 5,
                content: 'Spectacular city with scenic views and great food.',
            },
        });

        expect(review.status).toBe('APPROVED');
        expect(review.updatedAt).toBeDefined();

        await prisma.review.delete({ where: { id: review.id } });
    });

    it('enforces one review per user per city guide', async () => {
        const review1 = await prisma.review.create({
            data: {
                userId: testUserId,
                cityGuideId,
                rating: 4,
                content: 'First review of this wonderful destination.',
            },
        });

        await expect(
            prisma.review.create({
                data: {
                    userId: testUserId,
                    cityGuideId,
                    rating: 2,
                    content: 'Attempted duplicate review for the same city.',
                },
            })
        ).rejects.toThrow();

        await prisma.review.delete({ where: { id: review1.id } });
    });

    it('enforces one report per user per review and links correctly', async () => {
        const review = await prisma.review.create({
            data: {
                userId: testUserId,
                cityGuideId,
                rating: 1,
                content: 'Review that will receive a report test.',
            },
        });

        const reporter = await prisma.user.create({
            data: {
                email: `reporter-${Date.now()}@example.com`,
                name: 'Reporter User',
            },
        });

        const report = await prisma.reviewReport.create({
            data: {
                reviewId: review.id,
                reporterId: reporter.id,
                reason: 'SPAM',
                details: 'Commercial solicitation content.',
            },
        });

        expect(report.status).toBe('PENDING');

        // Duplicate report from same reporter should fail
        await expect(
            prisma.reviewReport.create({
                data: {
                    reviewId: review.id,
                    reporterId: reporter.id,
                    reason: 'OFFENSIVE',
                },
            })
        ).rejects.toThrow();

        // Audit log creation with SetNull on review delete
        const audit = await prisma.reviewModerationAudit.create({
            data: {
                reviewId: review.id,
                moderatorId: reporter.id,
                action: 'HIDE',
                reason: 'Violated content guidelines',
            },
        });

        expect(audit.action).toBe('HIDE');

        // Deleting review cascades to reports and sets reviewId to null on audit
        await prisma.review.delete({ where: { id: review.id } });

        const reloadedAudit = await prisma.reviewModerationAudit.findUnique({
            where: { id: audit.id },
        });
        expect(reloadedAudit?.reviewId).toBeNull();

        await prisma.reviewModerationAudit.delete({ where: { id: audit.id } });
        await prisma.user.delete({ where: { id: reporter.id } });
    });
});
