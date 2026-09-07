'use client';

import * as React from 'react';
import { GradientButton } from '@/components/ui/gradient-button';
import {
  generateTemporaryAccountPasswordAction,
  generateTemporaryTeamPasswordAction,
} from '@/lib/actions/credential-recovery-actions';

export interface TemporaryCredentialButtonProps {
  /** Which credential to rotate. */
  target: 'ACCOUNT' | 'TEAM';
  targetId: string;
  /** Shown in the confirmation copy, e.g. "@alex" or the squad name. */
  label: string;
  className?: string;
}

/**
 * Issues a temporary credential and displays it exactly once.
 *
 * WHY THERE IS NO "SHOW PASSWORD" ANYWHERE
 * ----------------------------------------
 * Existing passwords are stored as scrypt hashes and are not recoverable by
 * anyone, including the Creator. Recovery therefore REPLACES the credential
 * rather than revealing it — the previous one stops working the instant this
 * completes. That is a destructive act for the account holder, so it is behind a
 * two-step confirmation rather than a single click.
 *
 * The generated value lives only in this component's state. It is never written
 * to localStorage, never placed in the URL, and never logged — the audit trail
 * records that a reset happened, not what the value was.
 */
export function TemporaryCredentialButton({
  target,
  targetId,
  label,
  className = '',
}: TemporaryCredentialButtonProps) {
  const [phase, setPhase] = React.useState<'idle' | 'confirming' | 'issued'>('idle');
  const [busy, setBusy] = React.useState(false);
  const [password, setPassword] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function issue() {
    setBusy(true);
    setError(null);

    const res =
      target === 'ACCOUNT'
        ? await generateTemporaryAccountPasswordAction(targetId)
        : await generateTemporaryTeamPasswordAction(targetId);

    setBusy(false);

    if (res.success && res.data) {
      setPassword(res.data.temporaryPassword);
      setPhase('issued');
    } else {
      setError(res.error ?? 'Could not issue a temporary password.');
      setPhase('idle');
    }
  }

  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be denied; the value is on screen to read manually.
      setError('Could not copy automatically — select the password above and copy it manually.');
    }
  }

  function dismiss() {
    // Clearing state is the only place this value exists, so dismissing really
    // does destroy it. The Creator is warned before this becomes possible.
    setPassword(null);
    setPhase('idle');
    setCopied(false);
    setError(null);
  }

  if (phase === 'issued' && password) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 font-mono">
        <div className="space-y-1">
          <span className="text-[10px] font-bold tracking-wider text-amber-300 uppercase">
            Temporary password for {label}
          </span>
          <p className="text-muted-foreground font-sans text-[11px] leading-relaxed">
            Shown once. Copy it now and hand it over securely — it is not stored anywhere and cannot
            be retrieved again. The previous password no longer works.
          </p>
        </div>

        <code className="border-border/60 bg-background/80 block rounded-lg border px-3 py-2 text-sm font-bold break-all text-white select-all">
          {password}
        </code>

        <div className="flex flex-wrap gap-2">
          <GradientButton
            variant="cyan"
            size="sm"
            onClick={copy}
            className="text-[11px] font-semibold uppercase"
          >
            {copied ? 'Copied' : 'Copy password'}
          </GradientButton>
          <GradientButton
            variant="outline"
            size="sm"
            onClick={dismiss}
            className="text-[11px] font-semibold uppercase"
          >
            Done — hide it
          </GradientButton>
        </div>

        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </div>
    );
  }

  if (phase === 'confirming') {
    return (
      <div className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 font-mono">
        <p className="text-muted-foreground font-sans text-[11px] leading-relaxed">
          Issue a new temporary password for <span className="font-bold text-white">{label}</span>?{' '}
          {target === 'ACCOUNT'
            ? 'Their current password will stop working immediately and they will be signed out of every device.'
            : 'The current squad password will stop working immediately for anyone joining.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <GradientButton
            variant="magenta"
            size="sm"
            isLoading={busy}
            onClick={issue}
            className="text-[11px] font-semibold uppercase"
          >
            Yes, issue new password
          </GradientButton>
          <GradientButton
            variant="outline"
            size="sm"
            onClick={() => setPhase('idle')}
            className="text-[11px] font-semibold uppercase"
          >
            Cancel
          </GradientButton>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <GradientButton
        variant="outline"
        size="sm"
        onClick={() => setPhase('confirming')}
        className="text-[11px] font-semibold uppercase"
      >
        Generate temporary password
      </GradientButton>
      {error && <p className="font-mono text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}
