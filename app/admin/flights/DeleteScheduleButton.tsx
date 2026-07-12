"use client"

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteFlightScheduleAction } from '@/app/actions';

export default function DeleteScheduleButton({ id }: { id: number }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this flight schedule? Doing so will stop auto-generating future flight occurrences, but will not delete already generated flights.')) {
            return;
        }

        startTransition(async () => {
            try {
                await deleteFlightScheduleAction(id);
                router.refresh();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to delete schedule.';
                alert(message);
            }
        });
    };

    return (
        <button
            onClick={handleDelete}
            disabled={isPending}
            style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#ef4444',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.85rem',
                padding: '4px 8px',
                borderRadius: '4px'
            }}
        >
            {isPending ? 'Deleting...' : 'Delete'}
        </button>
    );
}
