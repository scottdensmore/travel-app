import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = {
    title: pageTitle('Page Not Found'),
    description: 'The requested flight, destination, or resource could not be found.',
};

/**
 * Branded 404 Not Found Page.
 * Styled with the travel-app aesthetic, providing quick flight search, status, and navigation recovery.
 */
export default function NotFound() {
    return (
        <main className="page-container not-found-page">
            <div className="not-found-card" role="region" aria-label="Page not found">
                <div className="not-found-icon" aria-hidden="true">
                    <svg
                        width="36"
                        height="36"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                    </svg>
                </div>

                <div className="not-found-code" aria-hidden="true">
                    404
                </div>

                <h1 className="not-found-title">Page Not Found</h1>

                <p className="not-found-message">
                    The page or flight destination you are looking for does not exist, has been rescheduled, or is temporarily unavailable.
                </p>

                <div className="not-found-shortcuts">
                    <Link href="/" className="not-found-link-primary">
                        Search Flights
                    </Link>
                    <Link href="/flight-status" className="not-found-link-secondary">
                        Flight Status
                    </Link>
                    <Link href="/" className="not-found-link-ghost">
                        Back to Home
                    </Link>
                </div>
            </div>
        </main>
    );
}
