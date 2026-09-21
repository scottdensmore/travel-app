import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TravelGuideClient from '@/components/ui/TravelGuideClient';
import * as actions from '@/app/actions';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: mockRefresh }),
}));

let mockSessionUser: { id: string; name: string } | null = { id: 'viewer-id', name: 'Viewer Traveler' };
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: mockSessionUser ? { user: mockSessionUser } : null,
        status: mockSessionUser ? 'authenticated' : 'unauthenticated',
    }),
}));

jest.mock('@/app/actions', () => ({
    toggleFavoriteCityGuideAction: jest.fn(),
    submitCityGuideReviewAction: jest.fn(),
    updateCityGuideReviewAction: jest.fn(),
    reportCityGuideReviewAction: jest.fn(),
}));

jest.mock('react-simple-maps', () => ({
    ComposableMap: ({ children }: any) => <svg data-testid="map">{children}</svg>,
    Geographies: ({ children }: any) => children({ geographies: [{ rsmKey: '1' }] }),
    Geography: () => <path />,
    Marker: ({ children, onClick }: any) => <g onClick={onClick} data-testid="marker">{children}</g>,
}));

describe('TravelGuideClient Reviews & Reporting', () => {
    const mockCities = [
        {
            id: 1,
            city: 'Kyoto',
            country: 'Japan',
            latlong: [35.0116, 135.7681],
            description: 'Historic city with temples and shrines.',
            coverImage: null,
            highlights: ['Fushimi Inari'],
            reviews: [
                {
                    id: 'rev-1',
                    rating: 5,
                    content: 'Incredible serene bamboo forests!',
                    status: 'APPROVED',
                    createdAt: new Date('2026-01-01T12:00:00Z'),
                    updatedAt: new Date('2026-01-01T12:00:00Z'),
                    userId: 'author-id',
                    user: { id: 'author-id', name: 'Author Traveler', image: null },
                },
            ],
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        mockSessionUser = { id: 'viewer-id', name: 'Viewer Traveler' };
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ type: 'Topology', objects: {} }),
        }) as unknown as typeof fetch;
    });

    it('renders report button for non-author and opens report modal', async () => {
        render(<TravelGuideClient cities={mockCities as any} initialFavorites={[]} />);

        // Click city card to open details
        fireEvent.click(screen.getByText('Kyoto, Japan'));

        const reportBtn = screen.getByRole('button', { name: /report review/i });
        expect(reportBtn).toBeInTheDocument();

        fireEvent.click(reportBtn);
        expect(screen.getByRole('dialog', { name: /report review/i })).toBeInTheDocument();
    });

    it('renders edited indicator when review was updated', () => {
        const editedCities = [
            {
                ...mockCities[0],
                reviews: [
                    {
                        ...mockCities[0].reviews[0],
                        updatedAt: new Date('2026-01-02T12:00:00Z'), // 1 day later
                    },
                ],
            },
        ];

        render(<TravelGuideClient cities={editedCities as any} initialFavorites={[]} />);
        fireEvent.click(screen.getByText('Kyoto, Japan'));

        expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument();
    });

    it('submits report via ReportReviewModal and calls reportCityGuideReviewAction', async () => {
        const mockReportAction = actions.reportCityGuideReviewAction as jest.Mock;
        mockReportAction.mockResolvedValue({ ok: true, data: { reportId: 'rep-123' } });

        render(<TravelGuideClient cities={mockCities as any} initialFavorites={[]} />);
        fireEvent.click(screen.getByText('Kyoto, Japan'));

        const reportBtn = screen.getByRole('button', { name: /report review/i });
        fireEvent.click(reportBtn);

        const dialog = screen.getByRole('dialog', { name: /report review/i });
        expect(dialog).toBeInTheDocument();

        // Select reason
        const reasonSelect = screen.getByLabelText(/reason/i);
        fireEvent.change(reasonSelect, { target: { value: 'SPAM' } });

        // Enter details
        const detailsInput = screen.getByLabelText(/details/i);
        fireEvent.change(detailsInput, { target: { value: 'This is unsolicited commercial spam.' } });

        // Submit report
        const submitBtn = screen.getByRole('button', { name: /submit report/i });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockReportAction).toHaveBeenCalledWith('rev-1', 'SPAM', 'This is unsolicited commercial spam.');
        });
    });

    it('renders author edit button and toggles review form into edit mode', async () => {
        mockSessionUser = { id: 'author-id', name: 'Author Traveler' };
        const mockUpdateAction = actions.updateCityGuideReviewAction as jest.Mock;
        mockUpdateAction.mockResolvedValue({ ok: true, data: { id: 'rev-1' } });

        render(<TravelGuideClient cities={mockCities as any} initialFavorites={[]} />);
        fireEvent.click(screen.getByText('Kyoto, Japan'));

        // Non-author report button should NOT be present for own review
        expect(screen.queryByRole('button', { name: /report review/i })).not.toBeInTheDocument();

        // Edit button should be present
        const editBtn = screen.getByRole('button', { name: /edit review/i });
        expect(editBtn).toBeInTheDocument();

        fireEvent.click(editBtn);

        // Form should be populated with existing review content and rating
        const textarea = screen.getByLabelText(/your review/i) as HTMLTextAreaElement;
        expect(textarea.value).toBe('Incredible serene bamboo forests!');

        // Button should say "Update Review"
        const updateBtn = screen.getByRole('button', { name: /update review/i });
        expect(updateBtn).toBeInTheDocument();

        // Cancel Edit button should be present
        const cancelBtn = screen.getByRole('button', { name: /cancel edit/i });
        expect(cancelBtn).toBeInTheDocument();

        // Edit the text and submit
        fireEvent.change(textarea, { target: { value: 'Updated: incredible bamboo forests and shrines!' } });
        fireEvent.click(updateBtn);

        await waitFor(() => {
            expect(mockUpdateAction).toHaveBeenCalledWith(
                'rev-1',
                5,
                'Updated: incredible bamboo forests and shrines!'
            );
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('cancels review editing mode when Cancel Edit is clicked', () => {
        mockSessionUser = { id: 'author-id', name: 'Author Traveler' };

        render(<TravelGuideClient cities={mockCities as any} initialFavorites={[]} />);
        fireEvent.click(screen.getByText('Kyoto, Japan'));

        const editBtn = screen.getByRole('button', { name: /edit review/i });
        fireEvent.click(editBtn);

        expect(screen.getByRole('button', { name: /update review/i })).toBeInTheDocument();

        const cancelBtn = screen.getByRole('button', { name: /cancel edit/i });
        fireEvent.click(cancelBtn);

        // Should return to normal submit mode
        expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument();
        const textarea = screen.getByLabelText(/your review/i) as HTMLTextAreaElement;
        expect(textarea.value).toBe('');
    });

    it('renders Under Moderator Review badge for pending or hidden author review', () => {
        mockSessionUser = { id: 'author-id', name: 'Author Traveler' };
        const pendingCities = [
            {
                ...mockCities[0],
                reviews: [
                    {
                        ...mockCities[0].reviews[0],
                        status: 'PENDING_MODERATION',
                    },
                ],
            },
        ];

        render(<TravelGuideClient cities={pendingCities as any} initialFavorites={[]} />);
        fireEvent.click(screen.getByText('Kyoto, Japan'));

        expect(screen.getByText(/under moderator review/i)).toBeInTheDocument();
    });
});
