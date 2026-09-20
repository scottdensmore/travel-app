'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { deleteAccountAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import type { DeletionEligibilityResult } from '@/lib/privacyService';

interface PrivacySettingsClientProps {
    userId: string;
    userEmail: string;
    userName: string;
    initialEligibility: DeletionEligibilityResult;
}

export default function PrivacySettingsClient({
    userId,
    userEmail,
    userName,
    initialEligibility,
}: PrivacySettingsClientProps) {
    const router = useRouter();
    const [isExporting, setIsExporting] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const modalPasswordInputRef = useRef<HTMLInputElement | null>(null);

    const handleDownloadExport = async () => {
        setIsExporting(true);
        setExportError(null);
        try {
            // Trigger direct browser download
            const response = await fetch('/api/privacy/export');
            if (!response.ok) {
                throw new Error('Export request failed');
            }
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `travel-app-data-export-${userId}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch {
            setExportError('Unable to download data export at this time. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleOpenModal = () => {
        setErrorMessage(null);
        setPassword('');
        setIsModalOpen(true);
        setTimeout(() => {
            modalPasswordInputRef.current?.focus();
        }, 50);
    };

    const handleCloseModal = () => {
        if (isDeleting) return;
        setIsModalOpen(false);
        setPassword('');
        setErrorMessage(null);
    };

    const handleConfirmDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsDeleting(true);

        try {
            const result = await deleteAccountAction(password);

            if (isActionValidationFailure(result)) {
                setErrorMessage(result.error.message);
                setIsDeleting(false);
                return;
            }

            // Successfully deleted - terminate session and redirect to landing page with banner
            await signOut({ redirect: false });
            router.push('/?accountDeleted=true');
            router.refresh();
        } catch (err) {
            console.error('Account deletion error:', err);
            setErrorMessage('An unexpected error occurred during account deletion. Please try again.');
            setIsDeleting(false);
        }
    };

    return (
        <div className="page-container privacy-page">
            <div className="privacy-header">
                <Link href="/profile" className="privacy-back-link">
                    ← Back to Profile
                </Link>
                <h1 className="text-3xl font-extrabold mt-2 text-white">Privacy &amp; Data Protection</h1>
                <p className="privacy-intro">
                    Manage your personal data rights under GDPR and CCPA. You have full self-service control
                    to export your account data or permanently delete your account and personal records.
                </p>
            </div>

            <div className="privacy-cards-grid">
                {/* 1. Data Portability / Export */}
                <section className="privacy-card" aria-labelledby="export-heading">
                    <div className="privacy-card-icon" aria-hidden="true">
                        📦
                    </div>
                    <h2 id="export-heading" className="text-xl font-bold text-white mb-2">
                        Download My Data
                    </h2>
                    <p className="privacy-card-text">
                        Download a comprehensive, machine-readable JSON archive of all personal data associated
                        with your account.
                    </p>
                    <div className="privacy-archive-includes">
                        <strong>Your export includes:</strong>
                        <ul>
                            <li>User profile details and preferences</li>
                            <li>Active and past booking history</li>
                            <li>Passenger records and seat assignments</li>
                            <li>Travel reviews and ratings</li>
                            <li>Saved city guide favorites</li>
                            <li>Account notifications and status points activity</li>
                        </ul>
                        <p className="privacy-security-note">
                            🔒 <em>Sensitive security credentials (passwords, salts, TOTP secret keys, and internal encryption keys) are strictly excluded.</em>
                        </p>
                    </div>

                    {exportError && (
                        <div role="alert" className="privacy-alert error mt-4">
                            {exportError}
                        </div>
                    )}

                    <div className="privacy-card-action mt-6">
                        <button
                            type="button"
                            onClick={handleDownloadExport}
                            disabled={isExporting}
                            className="privacy-button-primary"
                            aria-busy={isExporting}
                        >
                            {isExporting ? 'Generating JSON Export…' : 'Download My Data (JSON)'}
                        </button>
                    </div>
                </section>

                {/* 2. Right to Erasure / Account Deletion */}
                <section className="privacy-card danger-card" aria-labelledby="deletion-heading">
                    <div className="privacy-card-icon" aria-hidden="true">
                        ⚠️
                    </div>
                    <h2 id="deletion-heading" className="text-xl font-bold text-white mb-2">
                        Delete My Account
                    </h2>
                    <p className="privacy-card-text">
                        Permanently erase your account, scrub personal identity records, and terminate all active sessions.
                        This action cannot be undone.
                    </p>

                    <div className="privacy-deletion-policy-note">
                        <strong>Data Scrubbing Policy:</strong>
                        <p>
                            In accordance with our Passenger Identity Data Policy, any stored identity data
                            will be immediately purged. Your email, name, and personal identifiers will be scrambled,
                            and all active authentication sessions will be terminated.
                        </p>
                    </div>

                    {/* Pre-flight check warning */}
                    {!initialEligibility.eligible ? (
                        <div role="alert" className="privacy-alert warning mt-4">
                            <h3 className="font-bold text-yellow-400 mb-1">Deletion Currently Blocked</h3>
                            <p>{initialEligibility.message}</p>
                            <p className="mt-2 text-sm text-yellow-200">
                                Active reservations must be completed or cancelled before requesting account deletion.
                            </p>
                            <Link href="/profile" className="privacy-button-secondary inline-block mt-3">
                                View Your Bookings
                            </Link>
                        </div>
                    ) : (
                        <div className="privacy-eligible-note mt-4">
                            <span className="privacy-check-icon" aria-hidden="true">✓</span>
                            <span>Pre-flight check passed: No upcoming active flights detected.</span>
                        </div>
                    )}

                    <div className="privacy-card-action mt-6">
                        <button
                            type="button"
                            onClick={handleOpenModal}
                            disabled={!initialEligibility.eligible}
                            className="privacy-button-danger"
                            aria-disabled={!initialEligibility.eligible}
                        >
                            Delete My Account
                        </button>
                    </div>
                </section>
            </div>

            {/* Confirmation Modal */}
            {isModalOpen && (
                <div
                    className="rebooking-dialog-backdrop privacy-modal-backdrop"
                    role="presentation"
                    onClick={handleCloseModal}
                >
                    <div
                        className="rebooking-dialog privacy-modal-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-dialog-title"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="rebooking-dialog-heading">
                            <h2 id="delete-dialog-title" className="text-red-400">
                                Confirm Account Deletion
                            </h2>
                            <button
                                type="button"
                                onClick={handleCloseModal}
                                disabled={isDeleting}
                                aria-label="Close confirmation dialog"
                            >
                                ×
                            </button>
                        </div>

                        <div className="privacy-modal-body mt-4">
                            <p className="text-white mb-3">
                                <strong>Warning:</strong> You are about to permanently delete the account for{' '}
                                <span className="text-purple-300 font-semibold">{userEmail}</span>.
                            </p>
                            <p className="text-sm text-gray-300 mb-4">
                                This will scrub your name, email, and identity data, terminate all sessions,
                                and revoke account access. Past booking records will be anonymized for audit purposes.
                                <strong> This action is irreversible.</strong>
                            </p>

                            <form onSubmit={handleConfirmDelete} className="privacy-modal-form">
                                <div className="form-group mb-4">
                                    <label
                                        htmlFor="modal-password"
                                        className="block text-sm font-medium text-gray-200 mb-1"
                                    >
                                        Please enter your password to confirm:
                                    </label>
                                    <input
                                        ref={modalPasswordInputRef}
                                        id="modal-password"
                                        type="password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="Current password"
                                        required
                                        disabled={isDeleting}
                                        className="privacy-password-input"
                                    />
                                </div>

                                {errorMessage && (
                                    <div role="alert" className="privacy-alert error mb-4">
                                        {errorMessage}
                                    </div>
                                )}

                                <div className="rebooking-dialog-actions mt-6">
                                    <button
                                        type="button"
                                        onClick={handleCloseModal}
                                        disabled={isDeleting}
                                        className="privacy-button-secondary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isDeleting || !password}
                                        className="privacy-button-danger"
                                        aria-busy={isDeleting}
                                    >
                                        {isDeleting ? 'Deleting Account…' : 'Permanently Delete Account'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
