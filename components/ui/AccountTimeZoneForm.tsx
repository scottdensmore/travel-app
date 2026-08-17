'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateAccountTimeZoneAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';

interface AccountTimeZoneFormProps {
    timeZone: string;
    choices: string[];
}

export default function AccountTimeZoneForm({
    timeZone,
    choices,
}: AccountTimeZoneFormProps) {
    const router = useRouter();
    const [selected, setSelected] = useState(timeZone);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState<{
        kind: 'success' | 'error';
        message: string;
    } | null>(null);
    const pendingRef = useRef(false);
    const feedbackRef = useRef<HTMLParagraphElement | null>(null);

    useEffect(() => {
        if (feedback) feedbackRef.current?.focus();
    }, [feedback]);

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (pendingRef.current) return;

        pendingRef.current = true;
        setIsSaving(true);
        setFeedback(null);
        try {
            const result = await updateAccountTimeZoneAction(selected);
            if (isActionValidationFailure(result)) {
                setFeedback({ kind: 'error', message: result.error.message });
                return;
            }
            setSelected(result.timeZone);
            setFeedback({
                kind: 'success',
                message: `Payment receipt times now use ${result.timeZone}.`,
            });
            router.refresh();
        } catch {
            setFeedback({
                kind: 'error',
                message: 'Could not update your timezone. Please try again.',
            });
        } finally {
            pendingRef.current = false;
            setIsSaving(false);
        }
    };

    return (
        <section aria-labelledby="account-timezone-heading" className="account-timezone-settings">
            <h2 id="account-timezone-heading">Account timezone</h2>
            <p>Payment receipt times use this saved timezone, not this browser&apos;s location.</p>
            <form onSubmit={save} aria-label="Account timezone settings">
                <label htmlFor="account-timezone">Account timezone</label>
                <select
                    id="account-timezone"
                    value={selected}
                    onChange={event => setSelected(event.target.value)}
                    disabled={isSaving}
                >
                    {choices.map(choice => (
                        <option key={choice} value={choice}>{choice.replaceAll('_', ' ')}</option>
                    ))}
                </select>
                <button type="submit" aria-disabled={isSaving} aria-busy={isSaving}>
                    {isSaving ? 'Saving timezone…' : 'Save timezone'}
                </button>
            </form>
            {feedback && (
                <p
                    ref={feedbackRef}
                    role={feedback.kind === 'error' ? 'alert' : 'status'}
                    aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
                    tabIndex={-1}
                    className={`account-timezone-feedback ${feedback.kind}`}
                >
                    {feedback.message}
                </p>
            )}
        </section>
    );
}
