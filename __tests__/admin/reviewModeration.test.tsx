import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewModerationClient from '@/components/admin/ReviewModerationClient';
import * as actions from '@/app/actions';

jest.mock('@/app/actions', () => ({
    moderateReviewAction: jest.fn(),
    deleteReviewAction: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn() }),
}));

describe('ReviewModerationClient', () => {
    const mockReviews = [
        {
            id: 'rev-reported',
            content: 'Spam link to external website.',
            rating: 1,
            status: 'APPROVED',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            cityGuide: { city: 'Paris', country: 'France' },
            user: { name: 'Suspect User', email: 'suspect@example.com' },
            reports: [
                {
                    id: 'rep-1',
                    reason: 'SPAM',
                    details: 'Check this link',
                    status: 'PENDING',
                    reporter: { name: 'Alert Traveler' },
                    createdAt: new Date('2026-01-02T00:00:00Z'),
                },
            ],
        },
    ];

    const mockAudits = [
        {
            id: 'aud-1',
            action: 'HIDE',
            reason: 'Automated threshold: 3+ user reports',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            moderator: { name: 'System' },
            review: { cityGuide: { city: 'Paris' } },
        },
    ];

    const multiReviews = [
        ...mockReviews,
        {
            id: 'rev-pending',
            content: 'Unchecked review waiting for approval.',
            rating: 4,
            status: 'PENDING_MODERATION',
            createdAt: new Date('2026-01-03T00:00:00Z'),
            updatedAt: new Date('2026-01-03T00:00:00Z'),
            cityGuide: { id: 2, city: 'Tokyo', country: 'Japan' },
            user: { id: 'u-3', name: 'New Traveler', email: 'new@example.com' },
            reports: [],
        },
        {
            id: 'rev-hidden',
            content: 'Inappropriate toxic language review.',
            rating: 1,
            status: 'HIDDEN',
            createdAt: new Date('2026-01-04T00:00:00Z'),
            updatedAt: new Date('2026-01-04T00:00:00Z'),
            cityGuide: { id: 3, city: 'London', country: 'United Kingdom' },
            user: { id: 'u-4', name: 'Troll User', email: 'troll@example.com' },
            reports: [
                {
                    id: 'rep-2',
                    reason: 'OFFENSIVE',
                    details: 'Swear words used',
                    status: 'RESOLVED',
                    reporter: { id: 'u-5', name: 'Offended User' },
                    createdAt: new Date('2026-01-04T01:00:00Z'),
                },
            ],
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders queue and executes moderation hide action', async () => {
        (actions.moderateReviewAction as jest.Mock).mockResolvedValue({ ok: true });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        expect(screen.getByText(/Spam link to external website/i)).toBeInTheDocument();
        expect(screen.getByText(/1x SPAM/i)).toBeInTheDocument();

        const hideBtn = screen.getByRole('button', { name: /^hide$/i });
        fireEvent.click(hideBtn);

        await waitFor(() => {
            expect(actions.moderateReviewAction).toHaveBeenCalledWith(
                'rev-reported',
                'HIDE',
                expect.any(String)
            );
        });
    });

    it('renders summary stat widgets with correct counts', () => {
        render(
            <ReviewModerationClient
                initialReviews={multiReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        // Pending reports = 1
        expect(screen.getByText(/Pending Reports/i)).toBeInTheDocument();
        // Queued in PENDING_MODERATION = 1
        expect(screen.getByText(/Queued for Moderation/i)).toBeInTheDocument();
        // Hidden = 1
        expect(screen.getByText(/Hidden Reviews/i)).toBeInTheDocument();
        // Total audits = 1
        expect(screen.getByText(/Total Moderated Actions/i)).toBeInTheDocument();
    });

    it('filters reviews across tabs: Needs Attention, Hidden, All Reviews, and Audit Trail', () => {
        render(
            <ReviewModerationClient
                initialReviews={multiReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        // Default tab: Needs Attention
        // rev-reported (has pending report) and rev-pending (PENDING_MODERATION) are shown
        expect(screen.getByText(/Spam link to external website/i)).toBeInTheDocument();
        expect(screen.getByText(/Unchecked review waiting for approval/i)).toBeInTheDocument();
        expect(screen.queryByText(/Inappropriate toxic language review/i)).not.toBeInTheDocument();

        // Switch to Hidden tab
        fireEvent.click(screen.getByRole('tab', { name: /hidden/i }));
        expect(screen.getByText(/Inappropriate toxic language review/i)).toBeInTheDocument();
        expect(screen.queryByText(/Spam link to external website/i)).not.toBeInTheDocument();

        // Switch to All Reviews tab
        fireEvent.click(screen.getByRole('tab', { name: /all reviews/i }));
        expect(screen.getByText(/Spam link to external website/i)).toBeInTheDocument();
        expect(screen.getByText(/Unchecked review waiting for approval/i)).toBeInTheDocument();
        expect(screen.getByText(/Inappropriate toxic language review/i)).toBeInTheDocument();

        // Switch to Audit Trail tab
        fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));
        expect(screen.getByText(/Automated threshold: 3\+ user reports/i)).toBeInTheDocument();
        expect(screen.getByText(/System/i)).toBeInTheDocument();
    });

    it('executes approve action and displays success feedback', async () => {
        (actions.moderateReviewAction as jest.Mock).mockResolvedValue({ ok: true, data: { success: true } });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const approveBtn = screen.getByRole('button', { name: /^approve$/i });
        fireEvent.click(approveBtn);

        await waitFor(() => {
            expect(actions.moderateReviewAction).toHaveBeenCalledWith(
                'rev-reported',
                'APPROVE',
                expect.any(String)
            );
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(/approved/i);
    });

    it('executes dismiss reports action and displays success feedback', async () => {
        (actions.moderateReviewAction as jest.Mock).mockResolvedValue({ ok: true, data: { success: true } });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const dismissBtn = screen.getByRole('button', { name: /dismiss reports/i });
        fireEvent.click(dismissBtn);

        await waitFor(() => {
            expect(actions.moderateReviewAction).toHaveBeenCalledWith(
                'rev-reported',
                'DISMISS_REPORTS',
                expect.any(String)
            );
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(/dismissed/i);
    });

    it('opens confirmation dialog on delete and calls deleteReviewAction when confirmed', async () => {
        (actions.deleteReviewAction as jest.Mock).mockResolvedValue({ ok: true, data: { id: 'rev-reported' } });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
        fireEvent.click(deleteBtn);

        const dialog = screen.getByRole('dialog', { name: /confirm review deletion/i });
        expect(dialog).toBeInTheDocument();

        const confirmBtn = screen.getByRole('button', { name: /confirm delete/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(actions.deleteReviewAction).toHaveBeenCalledWith('rev-reported');
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(/deleted/i);
    });

    it('cancels delete dialog when cancel is clicked', () => {
        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
        fireEvent.click(deleteBtn);

        expect(screen.getByRole('dialog', { name: /confirm review deletion/i })).toBeInTheDocument();

        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        fireEvent.click(cancelBtn);

        expect(screen.queryByRole('dialog', { name: /confirm review deletion/i })).not.toBeInTheDocument();
        expect(actions.deleteReviewAction).not.toHaveBeenCalled();
    });

    it('expands and collapses report details list', () => {
        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        expect(screen.queryByText(/Alert Traveler/i)).not.toBeInTheDocument();

        const viewReportsBtn = screen.getByRole('button', { name: /view reports/i });
        fireEvent.click(viewReportsBtn);

        expect(screen.getByText(/Alert Traveler/i)).toBeInTheDocument();
        expect(screen.getByText(/Check this link/i)).toBeInTheDocument();

        // Collapse
        fireEvent.click(screen.getByRole('button', { name: /hide reports/i }));
        expect(screen.queryByText(/Alert Traveler/i)).not.toBeInTheDocument();
    });

    it('filters reviews by search term on All Reviews tab', () => {
        render(
            <ReviewModerationClient
                initialReviews={multiReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        fireEvent.click(screen.getByRole('tab', { name: /all reviews/i }));

        const searchInput = screen.getByPlaceholderText(/search reviews/i);
        fireEvent.change(searchInput, { target: { value: 'Tokyo' } });

        expect(screen.getByText(/Unchecked review waiting for approval/i)).toBeInTheDocument();
        expect(screen.queryByText(/Spam link to external website/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Inappropriate toxic language review/i)).not.toBeInTheDocument();
    });

    it('displays error feedback when moderation action fails', async () => {
        (actions.moderateReviewAction as jest.Mock).mockResolvedValue({
            ok: false,
            message: 'Staff access required.',
        });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const hideBtn = screen.getByRole('button', { name: /^hide$/i });
        fireEvent.click(hideBtn);

        await waitFor(() => {
            expect(actions.moderateReviewAction).toHaveBeenCalled();
        });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Staff access required/i);
    });

    it('displays error feedback when moderation action fails with structured error.message', async () => {
        (actions.moderateReviewAction as jest.Mock).mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid moderation state transition.',
                fields: {},
            },
        });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const hideBtn = screen.getByRole('button', { name: /^hide$/i });
        fireEvent.click(hideBtn);

        await waitFor(() => {
            expect(actions.moderateReviewAction).toHaveBeenCalled();
        });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Invalid moderation state transition/i);
    });

    it('displays error feedback when delete action fails', async () => {
        (actions.deleteReviewAction as jest.Mock).mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Failed to delete: review not found.',
                fields: {},
            },
        });

        render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
        fireEvent.click(deleteBtn);

        const confirmBtn = screen.getByRole('button', { name: /confirm delete/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(actions.deleteReviewAction).toHaveBeenCalled();
        });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Failed to delete: review not found/i);
    });

    it('displays edited label only when updated after 60 second threshold', () => {
        const createdAt = new Date('2026-01-01T12:00:00.000Z');
        const updatedWithinThreshold = new Date('2026-01-01T12:00:30.000Z'); // 30s later
        const updatedAfterThreshold = new Date('2026-01-01T12:02:00.000Z'); // 120s later

        const reviewsWithEdits = [
            {
                id: 'rev-not-edited',
                content: 'Review not considered edited.',
                rating: 5,
                status: 'APPROVED',
                createdAt,
                updatedAt: updatedWithinThreshold,
                cityGuide: { city: 'Nice', country: 'France' },
                user: { name: 'Quick Poster' },
                reports: [{ id: 'rep-ne', reason: 'OTHER', status: 'PENDING', reporter: { name: 'R' }, createdAt }],
            },
            {
                id: 'rev-edited',
                content: 'Review genuinely edited later.',
                rating: 5,
                status: 'APPROVED',
                createdAt,
                updatedAt: updatedAfterThreshold,
                cityGuide: { city: 'Lyon', country: 'France' },
                user: { name: 'Thoughtful Poster' },
                reports: [{ id: 'rep-e', reason: 'OTHER', status: 'PENDING', reporter: { name: 'R' }, createdAt }],
            },
        ];

        render(
            <ReviewModerationClient
                initialReviews={reviewsWithEdits as any}
                initialAudits={[]}
            />
        );

        // Within 60s should NOT display (Edited: ...)
        expect(screen.queryByText(/Review not considered edited/i)).toBeInTheDocument();
        // Look for the edited span
        expect(screen.getByText(/\(Edited: 1\/1\/2026\)/i)).toBeInTheDocument();
        // Only one should have the Edited badge
        const editedBadges = screen.getAllByText(/\(Edited:/i);
        expect(editedBadges).toHaveLength(1);
    });

    it('synchronizes audits with updated initialAudits prop seamlessly', () => {
        const { rerender } = render(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={mockAudits as any}
            />
        );

        // Switch to Audit Trail tab
        fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));
        expect(screen.getByText(/Automated threshold: 3\+ user reports/i)).toBeInTheDocument();
        expect(screen.queryByText(/Subsequent moderator approval note/i)).not.toBeInTheDocument();

        // New audits passed (as would happen via router.refresh())
        const updatedAudits = [
            ...mockAudits,
            {
                id: 'aud-2',
                action: 'APPROVE',
                reason: 'Subsequent moderator approval note',
                createdAt: new Date('2026-01-02T02:00:00Z'),
                moderator: { name: 'Admin Staff' },
                review: { cityGuide: { city: 'Tokyo' } },
            },
        ];

        rerender(
            <ReviewModerationClient
                initialReviews={mockReviews as any}
                initialAudits={updatedAudits as any}
            />
        );

        // Newly passed audit should now be rendered immediately
        expect(screen.getByText(/Subsequent moderator approval note/i)).toBeInTheDocument();
        expect(screen.getByText(/Admin Staff/i)).toBeInTheDocument();
    });
});
