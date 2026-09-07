import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm } from '@/components/auth/login-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign In',
  description:
    'Sign in to the ACN Cyber Odyssey investigation portal using your email or username.',
};

export default function LoginPage() {
  return (
    <AuthLayout
      pageTitle="Sign In"
      pageSubtitle="Enter your credentials to access the investigation workspace."
    >
      <LoginForm />
    </AuthLayout>
  );
}
