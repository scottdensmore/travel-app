"use client"
import React, { useState, useTransition } from 'react';
import { deleteCityGuideAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';

export default function DeleteGuideButton({ id }: { id: number }) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleDelete = () => {
        if (confirm('Are you sure you want to delete this guide?')) {
            setError(null);
            startTransition(async () => {
                try {
                    const result = await deleteCityGuideAction(id);
                    if (isActionValidationFailure(result)) {
                        setError(result.error.message);
                    }
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to delete guide.');
                }
            });
        }
    };

    return (
        <>
            <button
                onClick={handleDelete}
                disabled={isPending}
                className="text-red-600 hover:text-red-900 font-semibold"
            >
                {isPending ? 'Deleting...' : 'Delete'}
            </button>
            {error && <span role="alert" className="text-red-400 text-xs block mt-1">{error}</span>}
        </>
    );
}
