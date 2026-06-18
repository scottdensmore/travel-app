import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TitleBar from '@/components/ui/titlebar';
import { usePathname } from 'next/navigation';

// Mock Next.js navigation hooks
jest.mock('next/navigation', () => ({
    usePathname: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({ data: null })),
    signIn: jest.fn(),
    signOut: jest.fn(),
}));

describe('TitleBar', () => {
    it('renders the correct title when pathname is /book', () => {
        (usePathname as jest.Mock).mockReturnValue('/book');

        render(<TitleBar />);

        expect(screen.getByText('Book Flight', { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByAltText('Gemini Airways')).toBeInTheDocument();
    });

    it('renders the admin view when pathname is /admin/travelguide', () => {
        (usePathname as jest.Mock).mockReturnValue('/admin/travelguide');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({ data: { user: { role: 'ADMIN' } } });

        render(<TitleBar />);

        expect(screen.getByText('Admin')).toBeInTheDocument();
        // Standard links should not be present in admin view
        expect(screen.queryByText('Book Flight')).not.toBeInTheDocument();
    });

    it('calls signOut when the Sign Out button is clicked', () => {
        const mockSignOut = require('next-auth/react').signOut;
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({ data: { user: { role: 'USER', email: 'user@example.com' } } });

        render(<TitleBar />);

        const signOutButton = screen.getByRole('button', { name: 'Sign Out' });
        expect(signOutButton).toBeInTheDocument();
        
        const { fireEvent } = require('@testing-library/react');
        fireEvent.click(signOutButton);

        expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
});

