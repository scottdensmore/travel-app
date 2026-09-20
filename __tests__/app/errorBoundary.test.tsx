import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RootErrorBoundary from '@/app/error';
import GlobalError from '@/app/global-error';

describe('RootErrorBoundary (app/error.tsx)', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('renders user-friendly error UI without leaking raw stack traces, SQL errors, or file paths', () => {
        const sensitiveError = new Error(
            'CRITICAL_DATABASE_CRASH: SELECT * FROM credentials WHERE token = "secret_auth_token" at /var/www/internal/db/pool.ts:42'
        );
        sensitiveError.stack = 'Error: CRITICAL_DATABASE_CRASH\n    at /var/www/internal/db/pool.ts:42:15\n    at Query.run';

        const mockReset = jest.fn();

        render(<RootErrorBoundary error={sensitiveError} reset={mockReset} />);

        // Should render customer-friendly branded heading and message
        expect(screen.getByRole('heading', { level: 1, name: /something went wrong/i })).toBeInTheDocument();
        expect(screen.getByText(/we encountered an unexpected issue/i)).toBeInTheDocument();

        // Must NOT leak sensitive details
        expect(screen.queryByText(/CRITICAL_DATABASE_CRASH/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/SELECT \* FROM/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/secret_auth_token/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/\/var\/www\/internal/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Query\.run/i)).not.toBeInTheDocument();
    });

    it('displays a customer support incident reference code matching ERR- format', () => {
        const error = new Error('Payment processing network failure');
        const mockReset = jest.fn();

        render(<RootErrorBoundary error={error} reset={mockReset} />);

        const incidentElement = screen.getByText(/incident reference:\s*ERR-[A-Z0-9]+/i);
        expect(incidentElement).toBeInTheDocument();
    });

    it('uses deterministic error digest when provided by Next.js', () => {
        const errorWithDigest = Object.assign(new Error('Server component failure'), {
            digest: 'd893f412ab',
        });
        const mockReset = jest.fn();

        render(<RootErrorBoundary error={errorWithDigest} reset={mockReset} />);

        // Incident reference should incorporate sanitized digest deterministically
        expect(screen.getByText(/ERR-D893F412AB/i)).toBeInTheDocument();
    });

    it('calls reset when the "Try again" button is clicked', () => {
        const error = new Error('Render timeout');
        const mockReset = jest.fn();

        render(<RootErrorBoundary error={error} reset={mockReset} />);

        const tryAgainButton = screen.getByRole('button', { name: /try again/i });
        expect(tryAgainButton).toBeInTheDocument();

        fireEvent.click(tryAgainButton);
        expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it('provides a navigation link back to Home', () => {
        const error = new Error('Render error');
        const mockReset = jest.fn();

        render(<RootErrorBoundary error={error} reset={mockReset} />);

        const homeLink = screen.getByRole('link', { name: /back to home/i });
        expect(homeLink).toBeInTheDocument();
        expect(homeLink).toHaveAttribute('href', '/');
    });

    it('logs the actual error with the incident reference code to console for telemetry', () => {
        const error = new Error('Failed network payload');
        const mockReset = jest.fn();

        render(<RootErrorBoundary error={error} reset={mockReset} />);

        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedCall = consoleErrorSpy.mock.calls.find((callArgs: unknown[]) =>
            callArgs.some((arg: unknown) => typeof arg === 'string' && arg.includes('ERR-'))
        );
        expect(loggedCall).toBeDefined();
        // The original error should also be logged alongside the incident ID
        expect(loggedCall).toContain(error);
    });
});

describe('GlobalError (app/global-error.tsx)', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('renders inline html and body fallback without leaking sensitive details', () => {
        const error = new Error('FATAL_ROOT_CRASH: /etc/secrets/key.pem corrupted');
        const mockReset = jest.fn();

        const { container } = render(<GlobalError error={error} reset={mockReset} />);

        expect(container.querySelector('html')).toBeInTheDocument();
        expect(container.querySelector('body')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: /something went wrong/i })).toBeInTheDocument();
        expect(screen.getByText(/incident reference:\s*ERR-[A-Z0-9]+/i)).toBeInTheDocument();

        // No sensitive leaks
        expect(screen.queryByText(/FATAL_ROOT_CRASH/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/\/etc\/secrets/i)).not.toBeInTheDocument();
    });

    it('calls reset when "Try again" button is clicked on GlobalError', () => {
        const error = new Error('Root layout error');
        const mockReset = jest.fn();

        render(<GlobalError error={error} reset={mockReset} />);

        const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
        fireEvent.click(tryAgainBtn);
        expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it('provides a home link and logs telemetry on GlobalError', () => {
        const error = new Error('Root layout crash');
        const mockReset = jest.fn();

        render(<GlobalError error={error} reset={mockReset} />);

        const homeLink = screen.getByRole('link', { name: /back to home/i });
        expect(homeLink).toHaveAttribute('href', '/');

        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedCall = consoleErrorSpy.mock.calls.find((callArgs: unknown[]) =>
            callArgs.some((arg: unknown) => typeof arg === 'string' && arg.includes('ERR-'))
        );
        expect(loggedCall).toBeDefined();
        expect(loggedCall).toContain(error);
    });
});
