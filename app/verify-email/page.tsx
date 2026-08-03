import { Metadata } from 'next';
import AuthTokenPage from '@/components/auth/AuthTokenPage';

export const metadata: Metadata = {
    title: 'Verify email',
    description: 'Confirm your email address to finish creating your account.',
};

export default function VerifyEmailPage() {
    return <AuthTokenPage mode="verify" />;
}
