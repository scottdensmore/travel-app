'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthFlowShell from '@/components/auth/AuthFlowShell';
import { PasswordResetForm, VerifyEmailForm } from '@/components/auth/AuthTokenForms';
import { isValidAuthToken } from '@/lib/authTokenFormat';

type Mode = 'verify' | 'reset';

export default function AuthTokenPage({ mode }: { mode: Mode }) {
    const [token, setToken] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
        setToken(isValidAuthToken(value) ? value : null);
        window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`
        );
    }, []);

    const verifying = mode === 'verify';
    const title = verifying ? 'Confirm your email' : 'Choose a new password';
    const description = token === undefined
        ? 'Checking this secure link…'
        : token
            ? verifying
                ? 'For your security, confirm below to finish activating your account.'
                : 'Use at least 8 characters. This one-time link expires after one hour.'
            : verifying
                ? 'This link cannot be used. Request a fresh verification email to continue.'
                : 'This link cannot be used. Request a fresh password reset email to continue.';

    return (
        <AuthFlowShell title={title} description={description}>
            {token === undefined ? (
                <div role="status" aria-live="polite" className="text-sm text-zinc-300">
                    Checking secure link…
                </div>
            ) : token ? (
                verifying ? <VerifyEmailForm token={token} /> : <PasswordResetForm token={token} />
            ) : (
                <div className="grid gap-3 text-sm">
                    <div role="alert" className="text-red-400">
                        {verifying
                            ? 'This verification link is invalid or expired.'
                            : 'This password reset link is invalid or expired.'}
                    </div>
                    <Link
                        href={verifying ? '/resend-verification' : '/forgot-password'}
                        className="underline underline-offset-4"
                    >
                        {verifying
                            ? 'Request a new verification email'
                            : 'Request a new password reset email'}
                    </Link>
                </div>
            )}
        </AuthFlowShell>
    );
}
