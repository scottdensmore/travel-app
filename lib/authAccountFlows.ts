import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail, sendVerificationEmail } from '@/lib/authEmail';
import { consumeAuthToken, hasUsableAuthToken, issueAuthToken } from '@/lib/authTokens';

const VERIFICATION_LIFETIME_SECONDS = 24 * 60 * 60;
const RESET_LIFETIME_SECONDS = 60 * 60;

export async function requestEmailVerification(emailAddress: string): Promise<void> {
    const email = emailAddress.trim().toLowerCase();
    const user = await prisma.user.findUnique({
        where: { email },
        select: { emailVerified: true },
    });
    if (!user || user.emailVerified) return;

    const token = await issueAuthToken('verify-email', email, VERIFICATION_LIFETIME_SECONDS);
    await sendVerificationEmail(email, token);
}

export async function requestPasswordReset(emailAddress: string): Promise<void> {
    const email = emailAddress.trim().toLowerCase();
    const user = await prisma.user.findUnique({
        where: { email },
        select: { password: true, emailVerified: true },
    });
    if (!user?.password || !user.emailVerified) return;

    const token = await issueAuthToken('reset-password', email, RESET_LIFETIME_SECONDS);
    await sendPasswordResetEmail(email, token);
}

export async function verifyEmail(rawToken: string): Promise<boolean> {
    const result = await consumeAuthToken(
        'verify-email',
        rawToken,
        async (transaction, email) => {
            await transaction.user.update({
                where: { email },
                data: { emailVerified: new Date() },
            });
            return true;
        }
    );
    return result === true;
}

export async function resetPassword(rawToken: string, password: string): Promise<boolean> {
    if (!await hasUsableAuthToken('reset-password', rawToken)) return false;

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await consumeAuthToken(
        'reset-password',
        rawToken,
        async (transaction, email) => {
            await transaction.user.update({
                where: { email },
                data: {
                    password: passwordHash,
                    authVersion: { increment: 1 },
                },
            });
            return true;
        }
    );
    return result === true;
}
