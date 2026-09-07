import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/auth-layout';
import { SignupForm } from '@/components/auth/signup-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create an account to join the ACN Cyber Odyssey investigation.',
};

export default function SignupPage() {
  return (
    <AuthLayout
      pageTitle="Create Account"
      pageSubtitle="Register your profile to access the Cyber Odyssey event portal."
    >
      <SignupForm />
    </AuthLayout>
  );
}
