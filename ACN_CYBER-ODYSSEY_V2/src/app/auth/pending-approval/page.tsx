import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { PendingApprovalChecker } from '@/components/auth/pending-approval-checker';

export const metadata: Metadata = {
  title: 'Pending Approval',
  description: 'Your staff account is currently awaiting verification and approval.',
};

interface PendingApprovalPageProps {
  searchParams: Promise<{ role?: string }>;
}

export default async function PendingApprovalPage({ searchParams }: PendingApprovalPageProps) {
  const [params, user] = await Promise.all([searchParams, getSessionUser()]);

  // If user is already active in database, redirect immediately to their role portal
  if (user && user.status === 'ACTIVE') {
    if (user.role === 'CREATOR') redirect('/creator');
    if (user.role === 'ADMIN') redirect('/admin');
    if (user.role === 'EVALUATOR') redirect('/evaluator');
    if (user.role === 'PARTICIPANT') {
      redirect(user.membership ? '/dashboard' : '/team/onboarding');
    }
  }

  const role =
    user?.role === 'EVALUATOR'
      ? 'Evaluator'
      : user?.role === 'ADMIN'
        ? 'Administrator'
        : params.role || 'Staff';

  const initialStatus = user?.status || 'PENDING_APPROVAL';

  return (
    <div className="cyber-grid-bg relative flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 lg:p-10">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[450px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-600/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg space-y-6 text-center">
        {/* Verification Shield Icon */}
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-amber-500/40 bg-amber-950/30 text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.25)]">
          <svg
            className="size-8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </div>

        {/* Heading & Status */}
        <div className="space-y-2">
          <span className="font-mono text-xs font-semibold tracking-widest text-amber-400 uppercase">
            SECURITY CLEARANCE // LEVEL 0
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            WAITING FOR CREATOR APPROVAL
          </h1>
          <p className="text-muted-foreground text-sm">
            Your account has been submitted successfully.
          </p>
        </div>

        {/* Live Status Checker Component */}
        <PendingApprovalChecker initialRole={role} initialStatus={initialStatus} />
      </div>
    </div>
  );
}
