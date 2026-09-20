import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TitleBar from '@/components/ui/titlebar';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getUserNotificationsAction } from '@/app/actions';

jest.mock('next/navigation', () => ({
    usePathname: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
    useSession: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
}));

jest.mock('@/app/actions', () => ({
    getUserNotificationsAction: jest.fn(),
    markNotificationAsReadAction: jest.fn(),
    markAllNotificationsAsReadAction: jest.fn(),
}));

describe('TitleBar Accessibility (#80)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (usePathname as jest.Mock).mockReturnValue('/');
        (getUserNotificationsAction as jest.Mock).mockReturnValue(new Promise(() => {}));
    });

    it('renders titlebar logo with empty alt text so brand name is announced once', () => {
        (useSession as jest.Mock).mockReturnValue({ data: null });

        const { container } = render(<TitleBar />);

        // The brand logo image should be decorative (empty alt) so the adjacent
        // span provides the link text without stuttering "Mona Airways Mona Airways".
        const logoImg = container.querySelector('.logo a img');
        expect(logoImg).toBeInTheDocument();
        expect(logoImg).toHaveAttribute('alt', '');

        // Accessible name for the home link comes solely from the text span
        const brandLink = screen.getByRole('link', { name: 'Mona Airways' });
        expect(brandLink).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /mona airways/i })).not.toBeInTheDocument();
    });

    it('renders user profile image with an appropriate accessible label using Next.js Image', () => {
        (useSession as jest.Mock).mockReturnValue({
            data: {
                user: {
                    id: 'u1',
                    name: 'Taylor Swift',
                    email: 'taylor@example.com',
                    image: 'https://example.com/avatar.jpg',
                },
            },
        });

        render(<TitleBar />);

        // Profile avatar image must have accessible alt="Profile"
        const profileImg = screen.getByRole('img', { name: 'Profile' });
        expect(profileImg).toBeInTheDocument();
        expect(profileImg).toHaveAttribute('alt', 'Profile');

        // It should be wrapped in a link to /profile
        const profileLink = profileImg.closest('a');
        expect(profileLink).toHaveAttribute('href', '/profile');
    });
});
