'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions/auth-actions';

export interface CreatorSidebarProps {
  username: string;
  pendingApprovalsCount?: number | undefined;
  isPortalOnline?: boolean | undefined;
}

export function CreatorSidebar({
  username,
  pendingApprovalsCount = 0,
  isPortalOnline = true,
}: CreatorSidebarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const navItems = [
    {
      href: '/creator',
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
      href: '/creator/approvals',
      label: 'Staff Approvals',
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <polyline points="16 11 18 13 22 9" />
        </svg>
      ),
    },
    {
      href: '/creator/accounts',
      label: 'Accounts',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      href: '/creator/teams',
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
      href: '/creator/reports',
      label: 'Reports',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      ),
    },
    {
      href: '/creator/resources',
      label: 'Level 2 Resources',
      exact: true,
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      ),
    },
    {
      href: '/creator/resources/level-3',
      label: 'Level 3 Resources',
      exact: true,
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
      href: '/creator/portal-control',
      label: 'Portal Control',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Mobile Top Header */}
      <header className="border-border/80 bg-background/90 sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur-xl md:hidden">
        <Link href="/creator" className="flex items-center gap-2.5">
          <span className="flex size-2.5 rounded-full bg-fuchsia-400 shadow-[0_0_10px_rgba(217,70,239,0.8)]" />
          <div className="flex flex-col">
            <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-fuchsia-400 uppercase">
              ACN CYBER ODYSSEY
            </span>
            <span className="font-mono text-xs font-bold tracking-wider text-white">
              CREATOR CONTROL CENTER
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {pendingApprovalsCount > 0 && (
            <Link
              href="/creator/approvals"
              className="flex items-center gap-1 rounded-full border border-fuchsia-500/40 bg-fuchsia-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-fuchsia-300"
            >
              <span>{pendingApprovalsCount} PENDING</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="border-border bg-card/80 text-foreground hover:bg-card inline-flex items-center justify-center rounded-lg border p-2 focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
            aria-label="Toggle creator navigation menu"
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
            <Link href="/creator" className="group flex items-center gap-3">
              <span className="flex size-3 rounded-full bg-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.9)] transition-transform group-hover:scale-125" />
              <div className="flex flex-col">
                <span className="font-mono text-[10px] font-bold tracking-[0.25em] text-fuchsia-400 uppercase">
                  CYBER ODYSSEY
                </span>
                <span className="font-mono text-sm font-extrabold tracking-wider text-white">
                  CONTROL CENTER
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

          {/* Portal Operational Status Pill */}
          <Link
            href="/creator/portal-control"
            className={`flex items-center justify-between rounded-xl border px-3.5 py-2 font-mono text-[11px] transition-all ${
              isPortalOnline
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40'
                : 'border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/40'
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
          </Link>

          {/* Creator Navigation */}
          <nav className="space-y-1.5" aria-label="Creator portal navigation">
            <div className="text-muted-foreground/70 px-3 pb-1 font-mono text-[10px] font-semibold tracking-widest uppercase">
              OPERATIONS DESK
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
                      ? 'border border-fuchsia-500/50 bg-fuchsia-950/40 text-fuchsia-200 shadow-[0_0_16px_rgba(217,70,239,0.2)]'
                      : 'text-muted-foreground hover:border-border/60 hover:bg-card/60 hover:text-foreground border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`transition-colors ${
                        isActive
                          ? 'text-fuchsia-400'
                          : 'text-muted-foreground group-hover:text-fuchsia-400'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && (
                    <span className="rounded-full border border-fuchsia-500/50 bg-fuchsia-950/80 px-2 py-0.5 font-mono text-[10px] font-bold text-fuchsia-300 shadow-[0_0_8px_rgba(217,70,239,0.3)]">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section: User Identity & Sign Out */}
        <div className="border-border/80 bg-background/60 space-y-4 border-t p-4">
          <div className="flex items-center justify-between px-1 font-mono text-xs">
            <div className="flex flex-col">
              <span className="text-foreground truncate font-semibold">@{username}</span>
              <span className="text-[10px] font-bold tracking-wider text-fuchsia-400 uppercase">
                CREATOR AUTHORITY
              </span>
            </div>
            <span className="size-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(217,70,239,0.8)]" />
          </div>

          <form action={logoutAction} className="w-full">
            <button
              type="submit"
              className="border-border/70 bg-card/60 text-muted-foreground flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs font-semibold transition-all hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-300 focus-visible:ring-1 focus-visible:ring-fuchsia-400 focus-visible:outline-none"
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
