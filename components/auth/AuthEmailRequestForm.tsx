'use client';

import { FormEvent, useRef, useState } from 'react';

type Mode = 'verification' | 'password';

const config = {
    verification: {
        endpoint: '/api/auth/verification/request',
        button: 'Send verification email',
        pending: 'Sending verification email…',
    },
    password: {
        endpoint: '/api/auth/password/forgot',
        button: 'Send password reset email',
        pending: 'Sending password reset email…',
    },
} satisfies Record<Mode, { endpoint: string; button: string; pending: string }>;

export default function AuthEmailRequestForm({ mode }: { mode: Mode }) {
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const current = config[mode];

    const showError = (message: string) => {
        setError(message);
        window.setTimeout(() => errorRef.current?.focus(), 0);
    };

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPending(true);
        setNotice(null);
        setError(null);
        const email = String(new FormData(event.currentTarget).get('email') ?? '');

        try {
            const response = await fetch(current.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                showError(payload?.error?.message ?? 'Unable to submit this request right now.');
                return;
            }
            setNotice(payload?.message ?? 'If the account is eligible, an email will be sent shortly.');
        } catch {
            showError('Unable to submit this request right now. Please try again.');
        } finally {
            setPending(false);
        }
    }

    return (
        <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
                <label htmlFor="recovery-email" className="text-sm font-medium">Email address</label>
                <input
                    id="recovery-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={pending}
                    className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                />
            </div>
            {error && (
                <div ref={errorRef} role="alert" tabIndex={-1}
                    className="rounded-sm text-sm text-red-400 outline outline-2 outline-offset-2 outline-red-400">
                    {error}
                </div>
            )}
            {(pending || notice) && (
                <div role="status" aria-live="polite" className="text-sm text-zinc-300">
                    {pending ? current.pending : notice}
                </div>
            )}
            <button
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className="h-10 rounded-md bg-white px-4 text-sm font-medium text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
            >
                {pending ? current.pending : current.button}
            </button>
        </form>
    );
}
