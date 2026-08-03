import { Metadata } from 'next';
import AuthEmailRequestForm from '@/components/auth/AuthEmailRequestForm';
import AuthFlowShell from '@/components/auth/AuthFlowShell';

export const metadata: Metadata = {
    title: 'Forgot password',
    description: 'Request a link to reset your Mona Airways password.',
};

export default function ForgotPasswordPage() {
    return (
        <AuthFlowShell
            title="Reset your password"
            description="Enter your verified email address. We’ll send a one-time link if the account is eligible."
        >
            <AuthEmailRequestForm mode="password" />
        </AuthFlowShell>
    );
}
