import { Metadata } from 'next';
import AuthTokenPage from '@/components/auth/AuthTokenPage';

export const metadata: Metadata = { title: 'Reset password | Mona Airways' };

export default function ResetPasswordPage() {
    return <AuthTokenPage mode="reset" />;
}
