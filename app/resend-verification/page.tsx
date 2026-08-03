import { Metadata } from 'next';
import AuthEmailRequestForm from '@/components/auth/AuthEmailRequestForm';
import AuthFlowShell from '@/components/auth/AuthFlowShell';

export const metadata: Metadata = {
    title: 'Resend verification',
    description: 'Send the account verification email again.',
};

export default function ResendVerificationPage() {
    return (
        <AuthFlowShell
            title="Verify your email"
            description="Enter your email address and we’ll send a fresh verification link if the account is eligible."
        >
            <AuthEmailRequestForm mode="verification" />
        </AuthFlowShell>
    );
}
