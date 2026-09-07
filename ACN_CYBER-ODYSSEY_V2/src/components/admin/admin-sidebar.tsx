'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions/auth-actions';

export interface AdminSidebarProps {
  username: string;
  isPortalOnline?: boolean | undefined;
  pendingStaffCount?: number | undefined;
  unreadAnnouncementsCount?: number | undefined;
}

export function AdminSidebar({ username, isPortalOnline = true }: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const navItems = [
    {
      label: 'Overview',
      href: '/admin',
      active: pathname === '/admin',
      icon: (
        <svg
          className="size-4"
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
      label: 'Participants',
      href: '/admin/participants',
      active: pathname.startsWith('/admin/participants'),
      icon: (
        <svg
          className="size-4"
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
      label: 'Teams',
      href: '/admin/teams',
      active: pathname.startsWith('/admin/teams'),
      icon: (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      label: 'Reports to Creator',
      href: '/admin/reports',
      active: pathname.startsWith('/admin/reports'),
      icon: (
        <svg
          className="size-4"
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
      label: 'Levels',
      href: '/admin/levels',
      active: pathname.startsWith('/admin/levels'),
      icon: (
        <svg
          className="size-4"
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
      label: 'Evaluations',
      href: '/admin/evaluations',
      active: pathname.startsWith('/admin/evaluations'),
      icon: (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      label: 'Score Adjustments',
      href: '/admin/score-adjustments',
      active: pathname.startsWith('/admin/score-adjustments'),
      icon: (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
    {
      label: 'Announcements',
      href: '/admin/announcements',
      active: pathname.startsWith('/admin/announcements'),
      icon: (
        <svg
          className="size-4"
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
  ];

  async function handleLogout() {
    try {
      setIsLoggingOut(true);
      await logoutAction();
    } catch {
      setIsLoggingOut(false);
    }
  }

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4 font-mono text-xs sm:p-6">
      <div className="space-y-6">
        {/* Brand & Identity */}
        <div className="border-border/60 space-y-2 border-b pb-5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
              ADMIN CONTROL
            </span>
          </div>
          <div className="text-lg font-black tracking-tight text-white">CYBER ODYSSEY</div>
          <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
            <span>OPERATIONS DESK</span>
            <span>•</span>
            <span className={isPortalOnline ? 'text-emerald-400' : 'text-rose-400'}>
              {isPortalOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5" aria-label="Admin Portal Navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 font-medium transition-all ${
                item.active
                  ? 'border border-emerald-500/40 bg-emerald-950/40 font-bold text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                  : 'text-muted-foreground hover:border-border hover:bg-card/60 border border-transparent hover:text-white'
              }`}
            >
              <span className={item.active ? 'text-emerald-400' : 'text-muted-foreground'}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* User Info & Sign Out Footer */}
      <div className="border-border/60 space-y-3 border-t pt-4">
        <div className="flex items-center justify-between px-1">
          <div className="truncate">
            <div className="text-muted-foreground text-[10px] uppercase">OPERATOR</div>
            <div className="truncate font-bold text-white uppercase">@{username}</div>
          </div>
          <span className="rounded-md border border-emerald-500/30 bg-emerald-950/50 px-2 py-0.5 text-[9px] font-bold text-emerald-400">
            ADMIN
          </span>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 font-bold text-rose-300 transition-all hover:border-rose-500/50 hover:bg-rose-950/40 hover:text-white disabled:opacity-50"
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
          <span>{isLoggingOut ? 'SIGNING OUT...' : 'SIGN OUT'}</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="border-border/80 bg-card/80 fixed inset-y-0 left-0 z-30 hidden w-72 border-r shadow-2xl backdrop-blur-xl md:block">
        {sidebarContent}
      </aside>

      {/* Mobile Top Header Bar */}
      <div className="border-border/80 bg-card/90 sticky top-0 z-40 flex items-center justify-between border-b px-4 py-3 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-2 font-mono">
          <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs font-bold text-white">CYBER ODYSSEY // ADMIN</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="border-border text-muted-foreground hover:bg-card rounded-lg border p-2 hover:text-white"
          aria-label="Toggle navigation menu"
        >
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {mobileMenuOpen ? (
              <line x1="18" y1="6" x2="6" y2="18" />
            ) : (
              <>
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-black/80 backdrop-blur-md md:hidden">
          <div className="border-border/80 bg-card/95 fixed inset-y-0 left-0 w-72 border-r shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
