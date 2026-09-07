'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions/auth-actions';

export interface EvaluatorSidebarProps {
  username: string;
  pendingEvaluationsCount?: number | undefined;
  isPortalOnline?: boolean | undefined;
}

export function EvaluatorSidebar({
  username,
  pendingEvaluationsCount = 0,
  isPortalOnline = true,
}: EvaluatorSidebarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const navItems = [
    {
      href: '/evaluator',
      label: 'Overview',
      exact: true,
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
    },
    {
      href: '/evaluator/teams',
      label: 'Teams',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
    },
    {
      href: '/evaluator/submissions',
      label: 'Submissions',
      badge: pendingEvaluationsCount > 0 ? pendingEvaluationsCount : undefined,
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      href: '/evaluator/evaluations',
      label: 'Evaluations',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      href: '/evaluator/score-adjustments',
      label: 'Score Adjustments',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Mobile Top Header */}
      <header className="border-border/80 bg-background/90 sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur-xl md:hidden">
        <Link href="/evaluator" className="flex items-center gap-2.5">
          <span className="flex size-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
          <div className="flex flex-col">
            <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-cyan-400 uppercase">
              ACN CYBER ODYSSEY
            </span>
            <span className="font-mono text-xs font-bold tracking-wider text-white">
              EVALUATOR PORTAL
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {pendingEvaluationsCount > 0 && (
            <Link
              href="/evaluator/submissions"
              className="flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300"
            >
              <span>{pendingEvaluationsCount} PENDING</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="border-border bg-card/80 text-foreground hover:bg-card inline-flex items-center justify-center rounded-lg border p-2 focus-visible:ring-1 focus-visible:ring-cyan-400 focus-visible:outline-none"
            aria-label="Toggle evaluator navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Primary Left Sidebar */}
      <aside
        className={`border-border/80 bg-background/95 fixed inset-y-0 left-0 z-50 flex w-72 flex-col justify-between border-r backdrop-blur-2xl transition-transform duration-300 ease-in-out md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header & Navigation */}
        <div className="space-y-6 p-5">
          <div className="flex items-center justify-between">
            <Link href="/evaluator" className="group flex items-center gap-3">
              <span className="flex size-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)] transition-transform group-hover:scale-125" />
              <div className="flex flex-col">
                <span className="font-mono text-[10px] font-bold tracking-[0.25em] text-cyan-400 uppercase">
                  CYBER ODYSSEY
                </span>
                <span className="font-mono text-sm font-extrabold tracking-wider text-white">
                  EVALUATOR PORTAL
                </span>
              </div>
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 md:hidden"
              aria-label="Close navigation"
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Portal Operational Status Indicator (Read-Only) */}
          <div
            className={`flex items-center justify-between rounded-xl border px-3.5 py-2 font-mono text-[11px] ${
              isPortalOnline
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                : 'border-rose-500/30 bg-rose-950/20 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`size-2 rounded-full ${
                  isPortalOnline ? 'animate-pulse bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span className="text-muted-foreground uppercase">PORTAL STATUS</span>
            </div>
            <span className="font-bold">{isPortalOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>

          {/* Evaluator Navigation */}
          <nav className="space-y-1.5" aria-label="Evaluator portal navigation">
            <div className="text-muted-foreground/70 px-3 pb-1 font-mono text-[10px] font-semibold tracking-widest uppercase">
              JURY DESK
            </div>

            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center justify-between rounded-xl px-3.5 py-2.5 font-mono text-xs font-semibold transition-all ${
                    isActive
                      ? 'border border-cyan-500/50 bg-cyan-950/40 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.2)]'
                      : 'text-muted-foreground hover:border-border/60 hover:bg-card/60 hover:text-foreground border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`transition-colors ${
                        isActive
                          ? 'text-cyan-400'
                          : 'text-muted-foreground group-hover:text-cyan-400'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && (
                    <span className="rounded-full border border-cyan-500/50 bg-cyan-950/80 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.3)]">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section: Evaluator Identity & Sign Out */}
        <div className="border-border/80 bg-background/60 space-y-4 border-t p-4">
          <div className="flex items-center justify-between px-1 font-mono text-xs">
            <div className="flex flex-col">
              <span className="text-foreground truncate font-semibold">@{username}</span>
              <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase">
                EVALUATOR JURY
              </span>
            </div>
            <span className="size-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
          </div>

          <form action={logoutAction} className="w-full">
            <button
              type="submit"
              className="border-border/70 bg-card/60 text-muted-foreground flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs font-semibold transition-all hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-300 focus-visible:ring-1 focus-visible:ring-cyan-400 focus-visible:outline-none"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sign Out</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
