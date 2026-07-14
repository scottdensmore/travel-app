"use server";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
    createStaffMfaOtpAuthUri,
    decryptStaffMfaSecret,
    encryptStaffMfaSecret,
    generateStaffMfaSecret,
    verifyStaffTotpCode,
} from '@/lib/staffMfa';

async function requireEnrollmentSession() {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN' || session.user.staffMfaVerified) {
        throw new Error('Staff MFA enrollment is not available.');
    }
    return session;
}

export async function beginStaffMfaEnrollment() {
    const session = await requireEnrollmentSession();
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true, staffMfaEnrolledAt: true },
    });
    if (!user?.email || user.staffMfaEnrolledAt) {
        throw new Error('Staff MFA enrollment is not available.');
    }

    const secret = generateStaffMfaSecret();
    const encryptedSecret = encryptStaffMfaSecret(secret, session.user.id);
    const updated = await prisma.user.updateMany({
        where: { id: session.user.id, staffMfaEnrolledAt: null },
        data: {
            staffMfaSecretEncrypted: encryptedSecret,
            staffMfaLastUsedStep: null,
        },
    });
    if (updated.count !== 1) throw new Error('Staff MFA enrollment is not available.');

    return {
        manualKey: secret,
        otpAuthUri: createStaffMfaOtpAuthUri(secret, user.email),
    };
}

export async function confirmStaffMfaEnrollment(code: string) {
    const session = await requireEnrollmentSession();
    if (!/^\d{6}$/.test(code.trim())) {
        return { ok: false as const, error: 'Enter the six-digit code from your authenticator app.' };
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { staffMfaSecretEncrypted: true, staffMfaEnrolledAt: true },
    });
    if (!user?.staffMfaSecretEncrypted || user.staffMfaEnrolledAt) {
        return { ok: false as const, error: 'Start setup again and enter a new code.' };
    }

    let secret: string;
    try {
        secret = decryptStaffMfaSecret(user.staffMfaSecretEncrypted, session.user.id);
    } catch {
        return { ok: false as const, error: 'Start setup again and enter a new code.' };
    }
    const matchedStep = verifyStaffTotpCode(secret, code);
    if (matchedStep === null) {
        return { ok: false as const, error: 'That code is invalid or expired.' };
    }

    const updated = await prisma.user.updateMany({
        where: {
            id: session.user.id,
            staffMfaSecretEncrypted: user.staffMfaSecretEncrypted,
            staffMfaEnrolledAt: null,
        },
        data: {
            staffMfaEnrolledAt: new Date(),
            staffMfaLastUsedStep: matchedStep,
            authVersion: { increment: 1 },
        },
    });
    if (updated.count !== 1) {
        return { ok: false as const, error: 'Start setup again and enter a new code.' };
    }
    return { ok: true as const };
}
