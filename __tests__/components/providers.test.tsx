import React from 'react';
import { render, screen } from '@testing-library/react';
import {
    Providers,
    getOriginalConsoleError,
    setOriginalConsoleError,
} from '@/components/providers';

describe('Providers component and next-auth console.error interception', () => {
    let originalErrorMock: jest.Mock;
    let savedOriginalConsoleError: typeof console.error;

    beforeEach(() => {
        savedOriginalConsoleError = getOriginalConsoleError()!;
        originalErrorMock = jest.fn();
        setOriginalConsoleError(originalErrorMock);
    });

    afterEach(() => {
        setOriginalConsoleError(savedOriginalConsoleError);
    });

    it('renders its children correctly', () => {
        render(
            <Providers>
                <div data-testid="test-child">Child Component Content</div>
            </Providers>
        );
        expect(screen.getByTestId('test-child')).toBeInTheDocument();
        expect(screen.getByText('Child Component Content')).toBeInTheDocument();
    });

    it('suppresses [next-auth][error][CLIENT_FETCH_ERROR] with "Failed to fetch" for /api/auth/session', () => {
        console.error(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            '\nhttps://next-auth.js.org/errors#client_fetch_error',
            'Failed to fetch',
            {
                error: { message: 'Failed to fetch', name: 'TypeError' },
                message: 'Failed to fetch',
                url: '/api/auth/session',
            }
        );

        expect(originalErrorMock).not.toHaveBeenCalled();
    });

    it('suppresses [next-auth][error][CLIENT_FETCH_ERROR] with "NetworkError when attempting to fetch resource." for /api/auth/session', () => {
        console.error(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            '\nhttps://next-auth.js.org/errors#client_fetch_error',
            'NetworkError when attempting to fetch resource.',
            {
                error: { message: 'NetworkError when attempting to fetch resource.' },
                url: '/api/auth/session',
            }
        );

        expect(originalErrorMock).not.toHaveBeenCalled();
    });

    it('suppresses [next-auth][error][CLIENT_FETCH_ERROR] with "Load failed" for /api/auth/session', () => {
        console.error(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            'Load failed',
            { url: '/api/auth/session' }
        );

        expect(originalErrorMock).not.toHaveBeenCalled();
    });

    it('suppresses [next-auth][error][CLIENT_FETCH_ERROR] with name === "AbortError" for /api/auth/session', () => {
        console.error(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            {
                error: { name: 'AbortError', message: 'The user aborted a request.' },
                url: '/api/auth/session',
            }
        );

        expect(originalErrorMock).not.toHaveBeenCalled();
    });

    it('logs genuine next-auth errors with real 500 server error to original console.error', () => {
        const errorMetadata = {
            error: { message: 'Internal Server Error', status: 500 },
            message: 'Internal Server Error',
            url: '/api/auth/session',
        };

        console.error(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            '\nhttps://next-auth.js.org/errors#client_fetch_error',
            'Internal Server Error',
            errorMetadata
        );

        expect(originalErrorMock).toHaveBeenCalledTimes(1);
        expect(originalErrorMock).toHaveBeenCalledWith(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            '\nhttps://next-auth.js.org/errors#client_fetch_error',
            'Internal Server Error',
            errorMetadata
        );
    });

    it('logs next-auth errors with a different error code to original console.error', () => {
        console.error('[next-auth][error][OAUTH_CALLBACK_ERROR]', 'OAuth provider error');

        expect(originalErrorMock).toHaveBeenCalledTimes(1);
        expect(originalErrorMock).toHaveBeenCalledWith(
            '[next-auth][error][OAUTH_CALLBACK_ERROR]',
            'OAuth provider error'
        );
    });

    it('logs CLIENT_FETCH_ERROR for different endpoints to original console.error', () => {
        const errorMetadata = {
            error: { message: 'Failed to fetch' },
            url: '/api/auth/csrf',
        };

        console.error(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            'Failed to fetch',
            errorMetadata
        );

        expect(originalErrorMock).toHaveBeenCalledTimes(1);
        expect(originalErrorMock).toHaveBeenCalledWith(
            '[next-auth][error][CLIENT_FETCH_ERROR]',
            'Failed to fetch',
            errorMetadata
        );
    });

    it('logs unrelated console.error calls to original console.error', () => {
        console.error('Unhandled database exception', { code: 'ECONNREFUSED' });

        expect(originalErrorMock).toHaveBeenCalledTimes(1);
        expect(originalErrorMock).toHaveBeenCalledWith(
            'Unhandled database exception',
            { code: 'ECONNREFUSED' }
        );
    });
});
