'use client';

import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { generateIncidentCode } from '@/lib/incidentCode';

interface GlobalErrorProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/**
 * Global Layout Error Boundary for fatal root layout crashes.
 * Next.js requires global-error to define its own <html> and <body> tags.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
    const incidentCode = useMemo(() => generateIncidentCode(error), [error]);

    useEffect(() => {
        console.error(`[${incidentCode}] Fatal root layout error:`, error);
    }, [error, incidentCode]);

    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    padding: 0,
                    backgroundColor: '#0d0c14',
                    color: '#f3f4f6',
                    fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <main
                    style={{
                        width: 'min(100%, 34rem)',
                        margin: '1rem',
                        padding: '2.5rem 1.5rem',
                        borderRadius: '1rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
                        textAlign: 'center',
                        boxSizing: 'border-box',
                    }}
                    role="alert"
                    aria-live="assertive"
                >
                    <div
                        style={{
                            width: '4rem',
                            height: '4rem',
                            margin: '0 auto 1.25rem',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#f87171',
                        }}
                        aria-hidden="true"
                    >
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

                    <h1
                        style={{
                            fontSize: '1.75rem',
                            fontWeight: 'bold',
                            margin: '0 0 0.75rem',
                            color: '#ffffff',
                        }}
                    >
                        Something went wrong
                    </h1>
                    <p
                        style={{
                            color: '#d4d4d8',
                            fontSize: '0.95rem',
                            lineHeight: 1.6,
                            margin: '0 0 1.5rem',
                        }}
                    >
                        A critical error occurred while rendering the application shell. Our technical team has been notified.
                    </p>

                    <div
                        style={{
                            display: 'inline-block',
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            backgroundColor: 'rgba(139, 92, 246, 0.15)',
                            border: '1px solid rgba(139, 92, 246, 0.3)',
                            marginBottom: '2rem',
                            maxWidth: '100%',
                            boxSizing: 'border-box',
                        }}
                    >
                        <p
                            style={{
                                margin: 0,
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: '0.85rem',
                                color: '#c4b5fd',
                                letterSpacing: '0.04em',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {`Incident Reference: ${incidentCode}`}
                        </p>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            width: '100%',
                            boxSizing: 'border-box',
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => reset()}
                            style={{
                                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '0.5rem',
                                padding: '0.875rem 1.5rem',
                                fontWeight: 700,
                                fontSize: '1rem',
                                cursor: 'pointer',
                                minHeight: '48px',
                                width: '100%',
                                boxSizing: 'border-box',
                            }}
                        >
                            Try again
                        </button>
                        <Link
                            href="/"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textDecoration: 'none',
                                color: '#e2e8f0',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                borderRadius: '0.5rem',
                                padding: '0.875rem 1.5rem',
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                minHeight: '48px',
                                width: '100%',
                                boxSizing: 'border-box',
                            }}
                        >
                            Back to Home
                        </Link>
                    </div>
                </main>
            </body>
        </html>
    );
}
