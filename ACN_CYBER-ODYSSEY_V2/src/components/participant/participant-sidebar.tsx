'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions/auth-actions';

export interface ParticipantSidebarProps {
  username: string;
  teamName?: string | undefined;
  unreadAnnouncementsCount?: number | undefined;
}

export function ParticipantSidebar({
  username,
  teamName,
  unreadAnnouncementsCount = 0,
}: ParticipantSidebarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // Close mobile drawer on route change
  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const navItems = [
    {
      href: '/dashboard',
      label: 'Dashboard',
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
      href: '/event',
      label: 'Event',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      href: '/announcements',
      label: 'Announcements',
      badge: unreadAnnouncementsCount > 0 ? unreadAnnouncementsCount : undefined,
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      ),
    },
    {
      href: '/team',
      label: 'My Team',
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
      href: '/leaderboard',
      label: 'Leaderboard',
      icon: (
        <svg
          className="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 20V10" />
          <path d="M12 20V4" />
          <path d="M6 20v-6" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Mobile Top Header (Visible only on small screens) */}
      <header className="border-border/80 bg-background/90 sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur-xl md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="bg-cyan-accent flex size-2.5 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
          <div className="flex flex-col">
            <span className="text-cyan-accent font-mono text-[10px] font-semibold tracking-[0.2em] uppercase">
              ACN CYBER ODYSSEY
            </span>
            <span className="font-mono text-xs font-bold tracking-wider text-white">
              MISSION CONTROL
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {unreadAnnouncementsCount > 0 && (
            <Link
              href="/announcements"
              className="flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300"
            >
              <span>🔔</span>
              <span>{unreadAnnouncementsCount}</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="border-border bg-card/80 text-foreground hover:bg-card focus-visible:ring-cyan-accent inline-flex items-center justify-center rounded-lg border p-2 focus-visible:ring-1 focus-visible:outline-none"
            aria-label="Toggle navigation menu"
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

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Primary Left Sidebar (Desktop Fixed / Mobile Slide-in Drawer) */}
      <aside
        className={`border-border/80 bg-background/95 fixed inset-y-0 left-0 z-50 flex w-72 flex-col justify-between border-r backdrop-blur-2xl transition-transform duration-300 ease-in-out md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top: Branding & Mission Identifier */}
        <div className="space-y-6 p-5">
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="group flex items-center gap-3">
              <span className="bg-cyan-accent flex size-3 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.9)] transition-transform group-hover:scale-125" />
              <div className="flex flex-col">
                <span className="text-cyan-accent font-mono text-[10px] font-bold tracking-[0.25em] uppercase">
                  CYBER ODYSSEY
                </span>
                <span className="font-mono text-sm font-extrabold tracking-wider text-white">
                  MISSION CONTROL
                </span>
              </div>
            </Link>

            {/* Mobile close button inside drawer */}
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

          {/* Tactical Status Pill */}
          <div className="border-border/60 bg-card/40 flex items-center justify-between rounded-xl border px-3.5 py-2 font-mono text-[11px]">
            <div className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-muted-foreground uppercase">SYSTEM STATUS</span>
            </div>
            <span className="font-bold text-emerald-300">ONLINE</span>
          </div>

          {/* Primary Navigation Menu */}
          <nav className="space-y-1.5" aria-label="Participant portal navigation">
            <div className="text-muted-foreground/70 px-3 pb-1 font-mono text-[10px] font-semibold tracking-widest uppercase">
              MAIN OPERATIONS
            </div>

            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center justify-between rounded-xl px-3.5 py-2.5 font-mono text-xs font-semibold transition-all ${
                    isActive
                      ? 'border border-cyan-500/50 bg-cyan-950/40 text-cyan-200 shadow-[0_0_16px_rgba(6,182,212,0.2)]'
                      : 'text-muted-foreground hover:border-border/60 hover:bg-card/60 hover:text-foreground border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`transition-colors ${
                        isActive
                          ? 'text-cyan-300'
                          : 'text-muted-foreground group-hover:text-cyan-400'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && (
                    <span className="rounded-full border border-cyan-500/50 bg-cyan-950/80 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                      {item.badge} NEW
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section: Team Intel, User Identity & Sign Out */}
        <div className="border-border/80 bg-background/60 space-y-4 border-t p-4">
          {/* Squad Details Card */}
          {teamName && (
            <div className="border-border/60 bg-card/50 space-y-1 rounded-xl border p-3 font-mono text-xs">
              <span className="text-muted-foreground text-[10px] uppercase">OPERATIONAL SQUAD</span>
              <div className="truncate font-bold text-white">{teamName}</div>
            </div>
          )}

          {/* User Account Info */}
          <div className="flex items-center justify-between px-1 font-mono text-xs">
            <div className="flex flex-col">
              <span className="text-foreground truncate font-semibold">@{username}</span>
              <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                PARTICIPANT
              </span>
            </div>
            <span className="size-2 rounded-full bg-cyan-400" />
          </div>

          {/* Sign Out Action */}
          <form action={logoutAction} className="w-full">
            <button
              type="submit"
              className="border-border/70 bg-card/60 text-muted-foreground focus-visible:ring-cyan-accent flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs font-semibold transition-all hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-300 focus-visible:ring-1 focus-visible:outline-none"
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
