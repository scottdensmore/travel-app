'use client';

import React, { useState, useEffect, useRef } from 'react';
import { reportCityGuideReviewAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';

interface ReportReviewModalProps {
    isOpen?: boolean;
    reviewId: string;
    onClose: () => void;
    onSuccess?: () => void;
}

const REPORT_REASONS = [
    { value: 'SPAM', label: 'Spam or advertising' },
    { value: 'OFFENSIVE', label: 'Offensive or inappropriate content' },
    { value: 'HARASSMENT', label: 'Harassment or hate speech' },
    { value: 'MISINFORMATION', label: 'Misinformation or misleading content' },
    { value: 'OTHER', label: 'Other violation' },
];

export default function ReportReviewModal({
    isOpen = true,
    reviewId,
    onClose,
    onSuccess,
}: ReportReviewModalProps) {
    const [reason, setReason] = useState<string>('SPAM');
    const [details, setDetails] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const reasonSelectRef = useRef<HTMLSelectElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        reasonSelectRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFeedback(null);

        try {
            const trimmedDetails = details.trim() || undefined;
            const result = await reportCityGuideReviewAction(reviewId, reason, trimmedDetails);

            if (isActionValidationFailure(result)) {
                setFeedback({ message: result.error.message, isError: true });
                setIsSubmitting(false);
                return;
            }

            setFeedback({ message: 'Thank you. Your report has been submitted for moderator review.', isError: false });
            setIsSubmitting(false);
            if (onSuccess) {
                onSuccess();
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to submit report. Please try again.';
            setFeedback({ message: msg, isError: true });
            setIsSubmitting(false);
        }
    };

    return (
        <div
            role="presentation"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                boxSizing: 'border-box',
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="report-modal-title"
                style={{
                    background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    borderRadius: '16px',
                    padding: '24px',
                    maxWidth: '500px',
                    width: '100%',
                    boxSizing: 'border-box',
                    color: '#fff',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 id="report-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#c084fc', fontWeight: 'bold' }}>
                        Report Review
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.7)',
                            fontSize: '1.25rem',
                            cursor: 'pointer',
                            padding: '4px 8px',
                        }}
                    >
                        ✕
                    </button>
                </div>

                {feedback && (
                    <div
                        role="alert"
                        style={{
                            padding: '10px 14px',
                            marginBottom: '16px',
                            borderRadius: '6px',
                            backgroundColor: feedback.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                            border: feedback.isError ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(34, 197, 94, 0.4)',
                            color: feedback.isError ? '#f87171' : '#4ade80',
                            fontSize: '0.875rem',
                        }}
                    >
                        {feedback.message}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label
                            htmlFor="report-reason"
                            style={{ display: 'block', fontSize: '0.875rem', color: '#a78bfa', fontWeight: 'bold', marginBottom: '6px' }}
                        >
                            Reason for reporting
                        </label>
                        <select
                            id="report-reason"
                            ref={reasonSelectRef}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            disabled={isSubmitting}
                            style={{
                                width: '100%',
                                minHeight: '44px',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '0.95rem',
                                boxSizing: 'border-box',
                            }}
                        >
                            {REPORT_REASONS.map((r) => (
                                <option key={r.value} value={r.value}>
                                    {r.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <label
                                htmlFor="report-details"
                                style={{ fontSize: '0.875rem', color: '#a78bfa', fontWeight: 'bold' }}
                            >
                                Details (optional)
                            </label>
                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                                {details.length}/500
                            </span>
                        </div>
                        <textarea
                            id="report-details"
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            maxLength={500}
                            disabled={isSubmitting}
                            rows={4}
                            placeholder="Provide additional context to help our moderation team..."
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: '#fff',
                                fontSize: '0.95rem',
                                boxSizing: 'border-box',
                                resize: 'vertical',
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: 'transparent',
                                color: 'rgba(255, 255, 255, 0.8)',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            style={{
                                padding: '8px 20px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#c084fc',
                                color: '#0f0a19',
                                fontWeight: 'bold',
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                fontSize: '0.9rem',
                                opacity: isSubmitting ? 0.7 : 1,
                            }}
                        >
                            {isSubmitting ? 'Submitting...' : 'Submit Report'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
