"use client";

import React, { useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import {
    beginStaffMfaEnrollment,
    confirmStaffMfaEnrollment,
} from './actions';

export default function StaffMfaEnrollment() {
    const [setup, setSetup] = useState<{ manualKey: string; otpAuthUri: string } | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const errorRef = useRef<HTMLDivElement>(null);

    const begin = async () => {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            setSetup(await beginStaffMfaEnrollment());
        } catch {
            setError('Unable to start authenticator setup. Please try again.');
            window.setTimeout(() => errorRef.current?.focus(), 0);
        } finally {
            setPending(false);
        }
    };

    const confirm = async () => {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            const result = await confirmStaffMfaEnrollment(code);
            if (!result.ok) {
                setError(result.error);
                window.setTimeout(() => errorRef.current?.focus(), 0);
                return;
            }
            await signOut({ callbackUrl: '/login?staffMfa=enrolled' });
        } catch {
            setError('Unable to verify setup. Please try again.');
            window.setTimeout(() => errorRef.current?.focus(), 0);
        } finally {
            setPending(false);
        }
    };

    return (
        <section className="staff-mfa-card" aria-labelledby="staff-mfa-title">
            <h1 id="staff-mfa-title">Protect your staff account</h1>
            <p>
                Staff access requires a time-based security code in addition to your password.
                Add this account to an authenticator app before opening the admin dashboard.
            </p>

            {error && <div ref={errorRef} role="alert" tabIndex={-1}>{error}</div>}

            {!setup ? (
                <button type="button" onClick={begin} disabled={pending}>
                    {pending ? 'Starting setup…' : 'Set up authenticator'}
                </button>
            ) : (
                <div className="staff-mfa-setup">
                    <p><strong>Manual setup key</strong></p>
                    <code data-testid="staff-mfa-manual-key">{setup.manualKey}</code>
                    <a href={setup.otpAuthUri}>Open in authenticator app</a>
                    <label htmlFor="staff-mfa-code">Six-digit security code</label>
                    <input
                        id="staff-mfa-code"
                        name="staffMfaCode"
                        value={code}
                        onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        disabled={pending}
                    />
                    <button type="button" onClick={confirm} disabled={pending || code.length !== 6}>
                        {pending ? 'Verifying…' : 'Verify and finish setup'}
                    </button>
                    <button type="button" onClick={begin} disabled={pending} className="secondary-button">
                        Generate a new key
                    </button>
                </div>
            )}
        </section>
    );
}
