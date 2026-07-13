'use client';

import { FormEvent, useRef, useState } from 'react';

type Feedback = { type: 'error' | 'success'; message: string } | null;

function FeedbackMessage({ feedback, errorRef }: {
    feedback: Feedback;
    errorRef: React.RefObject<HTMLDivElement>;
}) {
    if (!feedback) return null;
    if (feedback.type === 'success') {
        return <div role="status" aria-live="polite" className="text-sm text-green-400">{feedback.message}</div>;
    }
    return (
        <div ref={errorRef} role="alert" tabIndex={-1}
            className="rounded-sm text-sm text-red-400 outline outline-2 outline-offset-2 outline-red-400">
            {feedback.message}
        </div>
    );
}

export function VerifyEmailForm({ token }: { token: string }) {
    const [pending, setPending] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const errorRef = useRef<HTMLDivElement>(null);

    async function verify() {
        setPending(true);
        setFeedback(null);
        try {
            const response = await fetch('/api/auth/verification/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                setFeedback({
                    type: 'error',
                    message: payload?.error?.message ?? 'Unable to verify this email right now.'
                });
                window.setTimeout(() => errorRef.current?.focus(), 0);
                return;
            }
            setFeedback({ type: 'success', message: payload.message });
        } catch {
            setFeedback({ type: 'error', message: 'Unable to verify this email right now. Please try again.' });
            window.setTimeout(() => errorRef.current?.focus(), 0);
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="grid gap-4">
            <FeedbackMessage feedback={feedback} errorRef={errorRef} />
            {pending && (
                <div role="status" aria-live="polite" className="text-sm text-zinc-300">
                    Verifying email…
                </div>
            )}
            {feedback?.type !== 'success' && (
                <button type="button" onClick={verify} disabled={pending} aria-busy={pending}
                    className="h-10 rounded-md bg-white px-4 text-sm font-medium text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60">
                    {pending ? 'Verifying email…' : 'Verify email'}
                </button>
            )}
        </div>
    );
}

export function PasswordResetForm({ token }: { token: string }) {
    const [pending, setPending] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const errorRef = useRef<HTMLDivElement>(null);

    const showError = (message: string) => {
        setFeedback({ type: 'error', message });
        window.setTimeout(() => errorRef.current?.focus(), 0);
    };

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const password = String(form.get('password') ?? '');
        const confirmation = String(form.get('passwordConfirmation') ?? '');
        if (password !== confirmation) {
            showError('Passwords must match.');
            return;
        }

        setPending(true);
        setFeedback(null);
        try {
            const response = await fetch('/api/auth/password/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                showError(payload?.error?.message ?? 'Unable to reset this password right now.');
                return;
            }
            setFeedback({ type: 'success', message: payload.message });
        } catch {
            showError('Unable to reset this password right now. Please try again.');
        } finally {
            setPending(false);
        }
    }

    if (feedback?.type === 'success') {
        return <FeedbackMessage feedback={feedback} errorRef={errorRef} />;
    }

    return (
        <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
                <label htmlFor="new-password" className="text-sm font-medium">New password</label>
                <input id="new-password" name="password" type="password" autoComplete="new-password"
                    minLength={8} maxLength={128} required disabled={pending}
                    className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" />
            </div>
            <div className="grid gap-2">
                <label htmlFor="confirm-password" className="text-sm font-medium">Confirm new password</label>
                <input id="confirm-password" name="passwordConfirmation" type="password"
                    autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending}
                    className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" />
            </div>
            <FeedbackMessage feedback={feedback} errorRef={errorRef} />
            {pending && <div role="status" aria-live="polite" className="text-sm text-zinc-300">Resetting password…</div>}
            <button type="submit" disabled={pending} aria-busy={pending}
                className="h-10 rounded-md bg-white px-4 text-sm font-medium text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? 'Resetting password…' : 'Reset password'}
            </button>
        </form>
    );
}
