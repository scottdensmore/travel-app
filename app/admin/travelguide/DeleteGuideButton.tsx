"use client"
import React, { useTransition } from 'react';
import { deleteCityGuideAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';

export default function DeleteGuideButton({ id }: { id: number }) {
    const [isPending, startTransition] = useTransition();

    const handleDelete = () => {
        if (confirm('Are you sure you want to delete this guide?')) {
            startTransition(async () => {
                const result = await deleteCityGuideAction(id);
                if (isActionValidationFailure(result)) alert(result.error.message);
            });
        }
    };

    return (
        <button
            onClick={handleDelete}
            disabled={isPending}
            className="text-red-600 hover:text-red-900 font-semibold"
        >
            {isPending ? 'Deleting...' : 'Delete'}
        </button>
    );
}
