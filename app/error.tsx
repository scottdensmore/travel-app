'use client';

import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { generateIncidentCode } from '@/lib/incidentCode';

interface ErrorBoundaryProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/**
 * Root Error Boundary for Next.js App Router.
 *
 * Catches unhandled client and server errors across page trees, deterministically
 * generates a customer-safe incident reference code, and logs error telemetry
 * without leaking raw stack traces, database queries, or server internals to users.
 */
export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
    const incidentCode = useMemo(() => generateIncidentCode(error), [error]);

    useEffect(() => {
        // Log telemetry with incident reference code
        console.error(`[${incidentCode}] Application error caught by root error boundary:`, error);
    }, [error, incidentCode]);

    return (
        <main className="page-container error-boundary-container">
            <div className="error-card" role="alert" aria-live="assertive">
                <div className="error-icon-wrapper" aria-hidden="true">
                    <svg
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                </div>

                <h1 className="error-title">Something went wrong</h1>
                <p className="error-message">
                    We encountered an unexpected issue while loading this page. Our technical team has been notified.
                </p>

                <div className="incident-badge">
                    <p className="incident-reference-text">
                        {`Incident Reference: ${incidentCode}`}
                    </p>
                </div>

                <div className="error-actions">
                    <button
                        type="button"
                        onClick={() => reset()}
                        className="error-retry-button"
                    >
                        Try again
                    </button>
                    <Link href="/" className="error-home-link">
                        Back to Home
                    </Link>
                </div>
            </div>
        </main>
    );
}
