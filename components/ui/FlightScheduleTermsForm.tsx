'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateFlightScheduleTermsAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { formatPrice } from '@/lib/bookingPricing';

interface FlightScheduleTermsFormProps {
    flightScheduleId: number;
    durationMinutes: number;
    priceCents: number;
    safeFutureCount: number;
    protectedCount: number;
}

export default function FlightScheduleTermsForm({
    flightScheduleId,
    durationMinutes: initialDurationMinutes,
    priceCents,
    safeFutureCount,
    protectedCount,
}: FlightScheduleTermsFormProps) {
    const router = useRouter();
    const [durationMinutes, setDurationMinutes] = useState(String(initialDurationMinutes));
    const [price, setPrice] = useState(formatPrice(priceCents));
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [isPending, setIsPending] = useState(false);
    const pendingRef = useRef(false);
    const requestId = useRef<string | null>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const successRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    useEffect(() => {
        if (success) successRef.current?.focus();
    }, [success]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!confirmed || pendingRef.current) return;
        pendingRef.current = true;
        setError(null);
        setSuccess(null);
        const stableRequestId = requestId.current ?? createScheduleUpdateRequestId();
        requestId.current = stableRequestId;
        const normalizedPrice = price.startsWith('$') ? price : `$${price}`;

        setIsPending(true);
        try {
            const result = await updateFlightScheduleTermsAction({
                requestId: stableRequestId,
                flightScheduleId,
                durationMinutes: Number(durationMinutes),
                price: normalizedPrice,
                confirmed,
            });
            if (isActionValidationFailure(result)) {
                setError(result.error.message);
                if (result.error.fields.requestId) requestId.current = null;
                return;
            }

            const updated = countLabel(
                result.updatedOccurrenceCount,
                'safe future occurrence',
            );
            const protectedRows = countLabel(
                result.protectedOccurrenceCount,
                'protected occurrence',
            );
            setSuccess(result.wasApplied
                ? `Updated the template and ${updated}. ${protectedRows} were unchanged. Audit ${result.changeId}.`
                : `Recovered the audited update: the template and ${updated} were already updated. ${protectedRows} were unchanged. Audit ${result.changeId}.`);
            requestId.current = null;
            setConfirmed(false);
            router.refresh();
        } catch {
            // The transaction may have committed before the response was
            // lost. Preserve the request key so Retry returns its durable
            // audit instead of applying a second change.
            setError('We could not confirm the update. Retry to safely recover the same request.');
        } finally {
            pendingRef.current = false;
            setIsPending(false);
        }
    };

    return (
        <section aria-labelledby="schedule-terms-heading" className="admin-card" style={{ marginBottom: 0 }}>
            <h2 id="schedule-terms-heading" style={{ color: '#c084fc', margin: '0 0 8px', fontSize: '1.35rem' }}>
                Update duration and fare
            </h2>
            <p style={{ color: '#e5e7eb', margin: '0 0 6px', lineHeight: 1.6 }}>
                {countLabel(safeFutureCount, 'safe future occurrence')} will receive the new values.{' '}
                {countLabel(protectedCount, 'protected occurrence')} will remain unchanged.
            </p>
            <p style={{ color: 'rgba(255, 255, 255, 0.65)', margin: '0 0 1rem', fontSize: '0.9rem' }}>
                Eligibility is checked again inside the update transaction. Route, departure time, operating days, and seating are not changed here.
            </p>

            {error && (
                <div
                    ref={errorRef}
                    role="alert"
                    tabIndex={-1}
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.45)', color: '#fca5a5', padding: '12px', borderRadius: '8px', marginBottom: '1rem' }}
                >
                    {error}
                </div>
            )}
            {success && (
                <div
                    ref={successRef}
                    role="status"
                    tabIndex={-1}
                    className="schedule-terms-success"
                    style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#86efac', padding: '12px', borderRadius: '8px', marginBottom: '1rem' }}
                >
                    {success}
                </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="admin-form-grid admin-form-grid--two">
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#a78bfa', fontWeight: 700, fontSize: '0.85rem' }}>
                        Duration (minutes)
                        <input
                            type="number"
                            min={1}
                            max={3 * 24 * 60}
                            step={1}
                            inputMode="numeric"
                            value={durationMinutes}
                            onChange={event => setDurationMinutes(event.target.value)}
                            disabled={isPending}
                            required
                        />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#a78bfa', fontWeight: 700, fontSize: '0.85rem' }}>
                        Fare ($)
                        <input
                            type="text"
                            value={price}
                            onChange={event => setPrice(event.target.value)}
                            disabled={isPending}
                            required
                        />
                    </label>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: '#e5e7eb', lineHeight: 1.5 }}>
                    <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={event => setConfirmed(event.target.checked)}
                        disabled={isPending}
                        style={{ marginTop: '4px' }}
                    />
                    I reviewed the impact above and understand that only safe future occurrences will change.
                </label>
                <button
                    type="submit"
                    disabled={!confirmed}
                    aria-disabled={isPending || !confirmed}
                    aria-busy={isPending}
                    style={{ alignSelf: 'flex-start' }}
                >
                    {isPending ? 'Updating schedule...' : 'Update duration and fare'}
                </button>
            </form>
        </section>
    );
}

function countLabel(count: number, singular: string) {
    return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function createScheduleUpdateRequestId(): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
