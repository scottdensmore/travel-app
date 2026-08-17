'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setFlightScheduleActiveAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';

interface FlightScheduleActivationFormProps {
    flightScheduleId: number;
    isActive: boolean;
    occurrenceCount: number;
}

export default function FlightScheduleActivationForm({
    flightScheduleId,
    isActive,
    occurrenceCount,
}: FlightScheduleActivationFormProps) {
    const router = useRouter();
    const [confirmed, setConfirmed] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const pendingRef = useRef(false);
    const errorRef = useRef<HTMLDivElement>(null);
    const successRef = useRef<HTMLDivElement>(null);
    const desiredActive = !isActive;

    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    useEffect(() => {
        if (success) successRef.current?.focus();
    }, [success]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!confirmed || pendingRef.current) return;
        pendingRef.current = true;
        setIsPending(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await setFlightScheduleActiveAction(
                flightScheduleId,
                desiredActive,
            );
            if (isActionValidationFailure(result)) {
                setError(result.error.message);
                return;
            }

            const occurrences = countLabel(
                result.preservedOccurrenceCount,
                'linked occurrence',
            );
            const state = desiredActive ? 'active' : 'deactivated';
            const preservation = `${occurrences} ${result.preservedOccurrenceCount === 1 ? 'was' : 'were'} preserved.`;
            setSuccess(result.changed
                ? `Template ${state}. ${preservation}`
                : `Template was already ${state}. ${preservation}`);
            setConfirmed(false);
            router.refresh();
        } catch {
            setError('We could not confirm the change. Retry to safely request the same state.');
        } finally {
            pendingRef.current = false;
            setIsPending(false);
        }
    };

    return (
        <section aria-labelledby="schedule-activation-heading" className="admin-card" style={{ marginBottom: 0 }}>
            <h2 id="schedule-activation-heading" style={{ color: '#c084fc', margin: '0 0 8px', fontSize: '1.35rem' }}>
                {isActive ? 'Deactivate template' : 'Reactivate template'}
            </h2>
            <p style={{ color: '#e5e7eb', margin: '0 0 6px', lineHeight: 1.6 }}>
                {isActive
                    ? 'Deactivation stops automatic and manual generation from this template.'
                    : 'Reactivation resumes automatic and manual generation without changing the linked occurrences.'}
            </p>
            <p style={{ color: 'rgba(255, 255, 255, 0.68)', margin: '0 0 1rem', lineHeight: 1.6 }}>
                {countLabel(occurrenceCount, 'linked occurrence')} and all associated bookings stay unchanged. This action is reversible.
            </p>

            {error && (
                <div ref={errorRef} role="alert" tabIndex={-1} className="schedule-activation-feedback" style={feedbackStyle('#fca5a5', 'rgba(239, 68, 68, 0.15)', 'rgba(239, 68, 68, 0.45)')}>
                    {error}
                </div>
            )}
            {success && (
                <div ref={successRef} role="status" tabIndex={-1} className="schedule-activation-feedback" style={feedbackStyle('#86efac', 'rgba(16, 185, 129, 0.15)', 'rgba(16, 185, 129, 0.4)')}>
                    {success}
                </div>
            )}

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: '#e5e7eb', lineHeight: 1.5 }}>
                    <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={event => setConfirmed(event.target.checked)}
                        disabled={isPending}
                        style={{ marginTop: '4px' }}
                    />
                    I understand existing occurrences and bookings remain unchanged.
                </label>
                <button
                    type="submit"
                    disabled={!confirmed}
                    aria-disabled={isPending || !confirmed}
                    aria-busy={isPending}
                    style={{ alignSelf: 'flex-start' }}
                >
                    {isPending
                        ? (desiredActive ? 'Reactivating template...' : 'Deactivating template...')
                        : (desiredActive ? 'Reactivate template' : 'Deactivate template')}
                </button>
            </form>
        </section>
    );
}

function countLabel(count: number, singular: string) {
    return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function feedbackStyle(color: string, backgroundColor: string, border: string) {
    return {
        backgroundColor,
        border: `1px solid ${border}`,
        color,
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '1rem',
    };
}
