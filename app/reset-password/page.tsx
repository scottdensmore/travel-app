import { Metadata } from 'next';
import AuthTokenPage from '@/components/auth/AuthTokenPage';

export const metadata: Metadata = {
    title: 'Reset password',
    description: 'Choose a new password for your Mona Airways account.',
};

export default function ResetPasswordPage() {
    return <AuthTokenPage mode="reset" />;
}
