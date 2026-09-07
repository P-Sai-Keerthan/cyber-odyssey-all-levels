'use client';

import * as React from 'react';
import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';

/**
 * Route-level error boundary for the whole portal.
 *
 * Without this, an unhandled error in any server component surfaced as a raw
 * Next.js error screen — and in a non-production build, a stack trace naming
 * internal files and query shapes. Participants mid-investigation saw a blank
 * crash with no way back.
 *
 * The `error.digest` shown here is the identifier Next.js also writes to the
 * server log. It lets an event marshal find the exact failure without the page
 * disclosing anything about the internals to the participant.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced in the server/browser log for the marshal desk. The message is
    // deliberately not rendered to the user.
    console.error('[portal] Unhandled route error:', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="border-border/80 bg-card/60 w-full max-w-lg space-y-6 rounded-2xl border p-8 font-mono shadow-2xl backdrop-blur-md">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-rose-400 uppercase">
            <span className="size-2 rounded-full bg-rose-400" aria-hidden="true" />
            <span>SYSTEM FAULT // TERMINAL INTERRUPTED</span>
          </div>
          <h1 className="font-sans text-xl font-bold tracking-tight text-white sm:text-2xl">
            Something went wrong on this screen
          </h1>
        </div>

        <div className="text-muted-foreground space-y-3 font-sans text-sm leading-relaxed">
          <p>
            The portal hit an unexpected error while loading this page.{' '}
            <span className="font-semibold text-white">Nothing you submitted has been lost</span> —
            this failure happened while displaying the page, not while saving your work.
          </p>
          <p>
            Try again below. If it keeps happening, move to another section and report it to an
            event marshal with the reference code shown.
          </p>
        </div>

        {error.digest && (
          <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-3 text-xs">
            <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
              Reference code for marshals
            </span>
            <div className="font-bold break-all text-cyan-300">{error.digest}</div>
          </div>
        )}

        <div className="border-border/40 flex flex-wrap items-center gap-3 border-t pt-5">
          <GradientButton
            variant="cyan"
            size="sm"
            onClick={reset}
            className="text-xs font-semibold uppercase"
          >
            Try again
          </GradientButton>
          <Link href="/dashboard">
            <GradientButton variant="outline" size="sm" className="text-xs font-semibold uppercase">
              Back to dashboard
            </GradientButton>
          </Link>
        </div>
      </div>
    </main>
  );
}
