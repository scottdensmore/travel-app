import { Metadata } from 'next';
import AuthTokenPage from '@/components/auth/AuthTokenPage';

export const metadata: Metadata = { title: 'Verify email | Mona Airways' };

export default function VerifyEmailPage() {
    return <AuthTokenPage mode="verify" />;
}
