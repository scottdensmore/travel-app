"use client"

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFlightStatusAction } from '@/app/actions';

export default function FlightStatusSelector({ id, currentStatus }: { id: number, currentStatus: string }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const nextStatus = e.target.value as 'ON_TIME' | 'DELAYED' | 'CANCELLED';
        startTransition(async () => {
            try {
                await updateFlightStatusAction(id, nextStatus);
                router.refresh();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to update flight status.';
                alert(message);
            }
        });
    };

    return (
        <select
            value={currentStatus}
            onChange={handleStatusChange}
            disabled={isPending}
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
            <option value="ON_TIME" style={{ backgroundColor: '#181720', color: '#fff' }}>On Time</option>
            <option value="DELAYED" style={{ backgroundColor: '#181720', color: '#fff' }}>Delayed</option>
            <option value="CANCELLED" style={{ backgroundColor: '#181720', color: '#fff' }}>Cancelled</option>
        </select>
    );
}
