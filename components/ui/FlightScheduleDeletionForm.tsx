'use client';

import { useEffect, useRef, useState } from 'react';
import { deleteFlightScheduleAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';

export default function FlightScheduleDeletionForm({
    flightScheduleId,
    occurrenceCount,
    protectedOccurrenceCount,
}: {
    flightScheduleId: number;
    occurrenceCount: number;
    protectedOccurrenceCount: number;
}) {
    const requestId = useRef(crypto.randomUUID());
    const pending = useRef(false);
    const [confirmed, setConfirmed] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const errorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!confirmed || pending.current) return;
        pending.current = true;
        setIsPending(true);
        setError(null);
        try {
            const result = await deleteFlightScheduleAction({
                requestId: requestId.current,
                flightScheduleId,
                confirmed: true,
            });
            if (isActionValidationFailure(result)) {
                setError(result.error.message);
            }
        } catch {
            setError('We could not confirm the deletion. Retry with the same safe request.');
        } finally {
            pending.current = false;
            setIsPending(false);
        }
    };

    return (
        <section aria-labelledby="schedule-deletion-heading" className="admin-card" style={{ marginBottom: 0 }}>
            <h2 id="schedule-deletion-heading" style={{ color: '#fca5a5', margin: '0 0 8px', fontSize: '1.35rem' }}>
                Delete inactive template permanently
            </h2>
            <p style={{ color: '#e5e7eb', margin: '0 0 6px', lineHeight: 1.6 }}>
                The template cannot be restored. All {occurrenceCount} linked occurrences and their bookings remain unchanged and become unlinked history.
            </p>
            <p style={{ color: 'rgba(255,255,255,0.68)', margin: '0 0 1rem' }}>
                {protectedOccurrenceCount} protected occurrences are included. An immutable deletion receipt preserves this template snapshot.
            </p>
            {error && (
                <div ref={errorRef} role="alert" tabIndex={-1} className="schedule-activation-feedback" style={{ color: '#fca5a5', marginBottom: '1rem' }}>
                    {error}
                </div>
            )}
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ color: '#e5e7eb' }}>
                    <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={isPending}
                        onChange={event => setConfirmed(event.target.checked)}
                    />{' '}
                    I understand this inactive template will be deleted permanently.
                </label>
                <button type="submit" disabled={!confirmed} aria-disabled={isPending || !confirmed} aria-busy={isPending} style={{ alignSelf: 'flex-start', color: '#fca5a5' }}>
                    {isPending ? 'Deleting template...' : 'Delete template permanently'}
                </button>
            </form>
        </section>
    );
}
