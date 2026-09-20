"use client"

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FlightStatus } from '@prisma/client';
import { updateFlightStatusAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { FLIGHT_STATUSES, flightStatusLabel } from '@/lib/flightStatus';

export default function FlightStatusSelector({ id, currentStatus }: { id: number, currentStatus: FlightStatus }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const nextStatus = e.target.value as FlightStatus;
        setError(null);
        startTransition(async () => {
            try {
                const result = await updateFlightStatusAction(id, nextStatus);
                if (isActionValidationFailure(result)) {
                    setError(result.error.message);
                    return;
                }
                router.refresh();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to update flight status.';
                setError(message);
            }
        });
    };

    return (
        <>
            <select
                value={currentStatus}
                onChange={handleStatusChange}
                disabled={isPending}
                aria-invalid={Boolean(error)}
                style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    outline: 'none',
                    width: '120px'
                }}
            >
                {FLIGHT_STATUSES.map((status) => (
                    <option key={status} value={status} style={{ backgroundColor: '#181720', color: '#fff' }}>
                        {flightStatusLabel(status)}
                    </option>
                ))}
            </select>
            {error && (
                <span role="alert" style={{ color: '#f87171', fontSize: '0.75rem', display: 'block', marginTop: '2px' }}>
                    {error}
                </span>
            )}
        </>
    );
}
