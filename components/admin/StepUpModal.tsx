'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface StepUpModalProps {
    isOpen: boolean;
    title: string;
    description: string;
    onClose: () => void;
    onSubmit: (code: string) => void | Promise<void>;
    error?: string | null;
    isSubmitting?: boolean;
}

export default function StepUpModal({
    isOpen,
    title,
    description,
    onClose,
    onSubmit,
    error,
    isSubmitting = false,
}: StepUpModalProps) {
    const [code, setCode] = useState('');
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            setCode('');
            // Focus input after render
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (!isSubmitting) {
                    e.preventDefault();
                    onClose();
                }
                return;
            }

            if (e.key !== 'Tab' || !dialogRef.current) return;

            const focusableElements = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
                )
            );
            if (focusableElements.length === 0) return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstElement || !dialogRef.current.contains(document.activeElement)) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement || !dialogRef.current.contains(document.activeElement)) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose, isSubmitting]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (code.trim().length === 6 && !isSubmitting) {
            onSubmit(code.trim());
        }
    };

    return (
        <div
            role="presentation"
            onClick={(e) => {
                if (e.target === e.currentTarget && !isSubmitting) onClose();
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
                aria-labelledby="step-up-modal-title"
                aria-describedby="step-up-modal-desc"
                tabIndex={-1}
                style={{
                    background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    borderRadius: '16px',
                    padding: '24px',
                    maxWidth: '440px',
                    width: '100%',
                    boxSizing: 'border-box',
                    color: '#fff',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div>
                        <h3 id="step-up-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#c084fc', fontWeight: 'bold' }}>
                            {title}
                        </h3>
                        <p id="step-up-modal-desc" style={{ margin: '6px 0 0 0', fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                            {description}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        aria-label="Close dialog"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.7)',
                            fontSize: '1.25rem',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            padding: '4px 8px',
                        }}
                    >
                        ✕
                    </button>
                </div>

                {error && (
                    <div
                        role="alert"
                        style={{
                            padding: '10px 14px',
                            marginBottom: '16px',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#f87171',
                            fontSize: '0.875rem',
                        }}
                    >
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div>
                        <label
                            htmlFor="step-up-security-code"
                            style={{ display: 'block', fontSize: '0.875rem', color: '#a78bfa', fontWeight: 'bold', marginBottom: '6px' }}
                        >
                            Security code
                        </label>
                        <input
                            id="step-up-security-code"
                            ref={inputRef}
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="123456"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            disabled={isSubmitting}
                            style={{
                                width: '100%',
                                minHeight: '44px',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: '#17142d',
                                color: '#fff',
                                fontSize: '1.25rem',
                                letterSpacing: '0.25em',
                                textAlign: 'center',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
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
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                fontSize: '0.9rem',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || code.length !== 6}
                            style={{
                                padding: '8px 20px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#c084fc',
                                color: '#0f0a19',
                                fontWeight: 'bold',
                                cursor: isSubmitting || code.length !== 6 ? 'not-allowed' : 'pointer',
                                fontSize: '0.9rem',
                                opacity: isSubmitting || code.length !== 6 ? 0.6 : 1,
                            }}
                        >
                            {isSubmitting ? 'Authorizing...' : 'Confirm & Authorize'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
