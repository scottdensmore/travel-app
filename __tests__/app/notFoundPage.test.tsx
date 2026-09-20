import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotFound from '@/app/not-found';

describe('NotFound (app/not-found.tsx)', () => {
    it('renders 404 heading, message, and branded styling', () => {
        render(<NotFound />);

        expect(screen.getByText('404')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeInTheDocument();
        expect(
            screen.getByText(/the page or flight destination you are looking for does not exist/i)
        ).toBeInTheDocument();
    });

    it('provides navigation shortcut links for flight search, flight status, and back to home', () => {
        render(<NotFound />);

        // Flight search shortcut link
        const searchLink = screen.getByRole('link', { name: /search flights/i });
        expect(searchLink).toBeInTheDocument();
        expect(searchLink.getAttribute('href')).toMatch(/^(\/|\/book)$/);

        // Flight status shortcut link
        const statusLink = screen.getByRole('link', { name: /flight status/i });
        expect(statusLink).toBeInTheDocument();
        expect(statusLink).toHaveAttribute('href', '/flight-status');

        // Back to home link
        const homeLink = screen.getByRole('link', { name: /back to home/i });
        expect(homeLink).toBeInTheDocument();
        expect(homeLink).toHaveAttribute('href', '/');
    });
});
