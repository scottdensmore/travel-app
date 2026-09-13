'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';

const TEARDOWN_PATTERN = /failed to fetch|networkerror|load failed|aborted/i;

function isTeardownError(val: unknown): boolean {
    if (typeof val === 'string') {
        return TEARDOWN_PATTERN.test(val);
    }
    if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        if (obj.name === 'AbortError') return true;
        if (typeof obj.message === 'string' && TEARDOWN_PATTERN.test(obj.message)) return true;
        if (obj.error && typeof obj.error === 'object') {
            const errObj = obj.error as Record<string, unknown>;
            if (errObj.name === 'AbortError') return true;
            if (typeof errObj.message === 'string' && TEARDOWN_PATTERN.test(errObj.message)) return true;
        }
    }
    return false;
}

function isSessionUrl(val: unknown): boolean {
    if (typeof val === 'string') {
        return val.includes('/api/auth/session');
    }
    if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        if (typeof obj.url === 'string' && obj.url.includes('/api/auth/session')) return true;
        try {
            if (JSON.stringify(val).includes('/api/auth/session')) return true;
        } catch {
            // Ignore circular references
        }
    }
    return false;
}

export function isSessionTeardownError(args: unknown[]): boolean {
    const hasSession = args.some(isSessionUrl);
    const hasTeardown = args.some(isTeardownError);
    return hasSession && hasTeardown;
}

let originalConsoleError = typeof console !== 'undefined' ? console.error : undefined;

export function getOriginalConsoleError(): typeof console.error | undefined {
    return originalConsoleError;
}

export function setOriginalConsoleError(fn: typeof console.error): void {
    originalConsoleError = fn;
}

interface InterceptedConsoleError {
    (...args: unknown[]): void;
    __isNextAuthInterceptor?: boolean;
    __original?: typeof console.error;
}

export function interceptConsoleError(): void {
    if (typeof window === 'undefined') return;
    const currentError = console.error as InterceptedConsoleError;
    if (currentError.__isNextAuthInterceptor) return;

    originalConsoleError = console.error;

    const wrappedConsoleError: InterceptedConsoleError = function (...args: unknown[]) {
        if (
            typeof args[0] === 'string' &&
            args[0].startsWith('[next-auth][error][CLIENT_FETCH_ERROR]') &&
            isSessionTeardownError(args)
        ) {
            return;
        }
        if (originalConsoleError) {
            originalConsoleError.apply(console, args);
        }
    };

    wrappedConsoleError.__isNextAuthInterceptor = true;
    wrappedConsoleError.__original = originalConsoleError;

    console.error = wrappedConsoleError;
}

if (typeof window !== 'undefined') {
    interceptConsoleError();
}

export function Providers({ children }: { children: React.ReactNode }) {
    return <SessionProvider>{children}</SessionProvider>;
}
