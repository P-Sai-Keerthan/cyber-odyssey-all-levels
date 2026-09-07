import * as React from 'react';
import { AuthVisual } from '@/components/auth/auth-visual';

interface AuthLayoutProps {
  children: React.ReactNode;
  pageTitle?: string;
  pageSubtitle?: string;
}

/**
 * Two-panel authentication layout for ACN Cyber Odyssey.
 * Desktop: form on the left (~48-50%), Cyber Odyssey visual panel on the right (~50-52%).
 * Mobile: form only, with a compact branded header.
 *
 * ---------------------------------------------------------------------------
 * SHORT VIEWPORTS & OVERFLOW HANDLING
 * ---------------------------------------------------------------------------
 * The centered form block uses automatic vertical margins (`my-auto`), which
 * centers content when free viewport height exists, and gracefully collapses to
 * zero when viewport height is constrained (e.g. 1366x768 or 1440x800).
 *
 * The page container maintains `min-h-svh` without arbitrary `overflow: hidden`,
 * allowing natural vertical scrolling so that all inputs, dropdowns, buttons,
 * and footer links remain completely accessible at all times.
 */
export function AuthLayout({
  children,
  pageTitle = 'AUTHENTICATION',
  pageSubtitle = 'Access the Cyber Odyssey investigation workspace.',
}: AuthLayoutProps) {
  return (
    <div className="cyber-grid-bg bg-background text-foreground relative min-h-svh w-full lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)]">
      {/* Left Column: Form Panel */}
      <main className="relative flex min-h-svh w-full flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:px-10 lg:py-8 xl:px-14 2xl:px-20">
        {/* Form Container Spine */}
        <div className="mx-auto my-auto w-full max-w-md space-y-6 py-2 sm:space-y-8">
          {/* Top Branding Header */}
          <header className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="border-border/80 bg-card/70 flex items-center gap-2 rounded-lg border px-2.5 py-1 shadow-sm backdrop-blur-sm">
                <span className="font-mono text-sm font-black tracking-wider text-rose-500">
                  ACN
                </span>
                <span className="bg-border h-3 w-px" />
                <span className="text-muted-foreground font-mono text-[9px] font-semibold tracking-[0.2em] uppercase">
                  AMRITA CYBER NATION
                </span>
              </div>
              <div className="text-cyan-accent/90 hidden items-center gap-1.5 font-mono text-[10px] sm:flex">
                <span className="bg-cyan-accent size-1.5 animate-pulse rounded-full shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                <span>SYS_READY</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <h1 className="text-foreground text-2xl leading-tight font-bold tracking-tight uppercase sm:text-3xl">
                {pageTitle}
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">{pageSubtitle}</p>
            </div>

            <div
              aria-hidden="true"
              className="from-cyan-accent/60 via-primary/50 h-px w-full bg-gradient-to-r to-transparent"
            />
          </header>

          {/* Form Body */}
          <div>{children}</div>
        </div>

        {/* Bottom Status / Security Footer */}
        <footer className="border-border/40 text-muted-foreground/80 mx-auto mt-6 w-full max-w-md shrink-0 space-y-1 border-t pt-4 font-mono text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-foreground/85 font-semibold tracking-wider uppercase">
              TRACE // INVESTIGATION WORKSPACE
            </span>
            <span className="text-cyan-accent/70 text-[10px]">BUILD-STABLE</span>
          </div>
          <p className="text-muted-foreground/60 text-[10px] leading-normal">
            All access is authenticated and audited. Unauthorized actions are strictly logged.
          </p>
        </footer>
      </main>

      {/* Right Column: Mission Control Visual Artwork (Desktop) */}
      <AuthVisual />
    </div>
  );
}
