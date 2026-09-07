'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';
import { getAccountApprovalStatusAction } from '@/lib/actions/auth-actions';

interface PendingApprovalCheckerProps {
  initialRole: string;
  initialStatus?: string;
}

export function PendingApprovalChecker({
  initialRole,
  initialStatus = 'PENDING_APPROVAL',
}: PendingApprovalCheckerProps) {
  const router = useRouter();
  const [status, setStatus] = React.useState<string>(initialStatus);
  const [role, setRole] = React.useState<string>(initialRole);
  const [destination, setDestination] = React.useState<string | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [checkCount, setCheckCount] = React.useState(0);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  const checkStatus = React.useCallback(async () => {
    setIsChecking(true);
    try {
      const result = await getAccountApprovalStatusAction();
      if (result.success && result.data) {
        const currentStatus = result.data.status;
        if (result.data.role) {
          setRole(
            result.data.role === 'EVALUATOR'
              ? 'Evaluator'
              : result.data.role === 'ADMIN'
                ? 'Administrator'
                : result.data.role,
          );
        }

        if (currentStatus === 'ACTIVE') {
          setStatus('ACTIVE');
          const dest =
            result.data.destination ||
            (result.data.role === 'EVALUATOR'
              ? '/evaluator'
              : result.data.role === 'ADMIN'
                ? '/admin'
                : result.data.role === 'CREATOR'
                  ? '/creator'
                  : '/dashboard');
          setDestination(dest);
          setFeedback('Security clearance approved! Entering portal...');

          // Navigate to destination
          setTimeout(() => {
            router.push(dest);
            router.refresh();
          }, 800);
          return true;
        } else if (currentStatus === 'BLOCKED' || currentStatus === 'SUSPENDED') {
          setStatus('BLOCKED');
          setFeedback('This account has been blocked by an administrator.');
          return true;
        } else if (currentStatus === 'REJECTED') {
          setStatus('REJECTED');
          setFeedback('This access request was not approved by the event Creator.');
          return true;
        }
      }
    } catch {
      // Network hiccup — gracefully try next tick
    } finally {
      setIsChecking(false);
      setCheckCount((c) => c + 1);
    }
    return false;
  }, [router]);

  // Periodic polling at a safe 5s interval (non-aggressive, automatic cleanup)
  React.useEffect(() => {
    if (status !== 'PENDING_APPROVAL') return;

    const interval = setInterval(async () => {
      const isTerminal = await checkStatus();
      if (isTerminal) {
        clearInterval(interval);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [checkStatus, status]);

  // Terminal state: Approved / Active
  if (status === 'ACTIVE') {
    return (
      <div className="space-y-6">
        <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-6 text-center font-mono text-xs leading-relaxed text-emerald-200 backdrop-blur-md">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-900/40 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <svg
              className="size-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-lg font-bold tracking-tight text-white">
            SECURITY CLEARANCE GRANTED
          </h2>
          <p className="text-emerald-300">
            {feedback || 'Your account is now ACTIVE. Redirecting to your portal desk...'}
          </p>
        </div>

        {destination && (
          <Link href={destination} className="block w-full">
            <GradientButton
              variant="cyan"
              fullWidth
              className="text-sm font-semibold tracking-wider uppercase"
            >
              Enter {role} Portal Now →
            </GradientButton>
          </Link>
        )}
      </div>
    );
  }

  // Terminal state: Blocked or Rejected
  if (status === 'BLOCKED' || status === 'SUSPENDED' || status === 'REJECTED') {
    const isRejected = status === 'REJECTED';
    return (
      <div className="space-y-6">
        <div className="space-y-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-6 text-center font-mono text-xs leading-relaxed text-rose-200 backdrop-blur-md">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-rose-500/40 bg-rose-900/40 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
            <svg
              className="size-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <h2 className="text-lg font-bold tracking-tight text-white">
            {isRejected ? 'ACCESS REQUEST NOT APPROVED' : 'ACCOUNT BLOCKED'}
          </h2>
          <p className="text-rose-300">
            {isRejected
              ? 'This staff clearance request was reviewed and rejected. If you believe this is in error, please contact the event Creator.'
              : 'This account has been blocked from accessing event portals. Contact an event marshal for assistance.'}
          </p>
        </div>

        <Link href="/login" className="block w-full">
          <GradientButton variant="outline" fullWidth className="text-sm font-semibold uppercase">
            ← Return to Sign In
          </GradientButton>
        </Link>
      </div>
    );
  }

  // Pending State
  return (
    <div className="space-y-6">
      {/* Notice Card */}
      <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 text-left font-mono text-xs leading-relaxed text-amber-200/90 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5">
          <span className="text-muted-foreground">ACCOUNT ROLE</span>
          <span className="font-bold text-amber-300 uppercase">{role}</span>
        </div>
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5">
          <span className="text-muted-foreground">AUTHORIZATION STATUS</span>
          <span className="flex items-center gap-1.5 font-semibold text-amber-400">
            <span className="size-2 animate-pulse rounded-full bg-amber-400" />
            PENDING_APPROVAL
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5 text-[11px]">
          <span className="text-muted-foreground">LIVE SYNC MONITOR</span>
          <span className="text-muted-foreground/90">
            {isChecking ? 'Checking status...' : `Active (checked ${checkCount}x)`}
          </span>
        </div>

        <p className="pt-1 text-xs">
          Your account has been submitted successfully. A Creator must approve your access before
          you can enter the portal. To protect operational integrity, privileged accounts require
          manual clearance.
        </p>
        <p className="text-muted-foreground/80 border-t border-amber-500/20 pt-2 text-[11px]">
          Once approved by the Creator, this page will automatically detect your active clearance
          and grant access without needing to re-register.
        </p>
      </div>

      {/* Interactive Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={isChecking}
          onClick={() => checkStatus()}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 font-mono text-xs font-bold text-amber-300 transition-colors hover:bg-amber-900/40 focus-visible:ring-1 focus-visible:ring-amber-400 focus-visible:outline-none disabled:opacity-50 sm:w-1/2"
        >
          <svg
            className={`size-3.5 ${isChecking ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          <span>{isChecking ? 'Verifying...' : 'Check Status Now'}</span>
        </button>

        <Link href="/login" className="block w-full sm:w-1/2">
          <GradientButton
            variant="outline"
            fullWidth
            className="h-10 text-xs font-semibold uppercase"
          >
            ← Return to Sign In
          </GradientButton>
        </Link>
      </div>
    </div>
  );
}
