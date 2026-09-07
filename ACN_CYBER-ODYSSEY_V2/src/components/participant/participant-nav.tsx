'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions/auth-actions';

export interface ParticipantNavProps {
  username: string;
  teamName?: string | undefined;
  teamCode?: string | undefined;
}

export function ParticipantNav({ username, teamName, teamCode }: ParticipantNavProps) {
  const pathname = usePathname();

  const navItems = [
    {
      href: '/dashboard',
      label: 'Dashboard',
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
      href: '/team',
      label: 'My Team',
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
      href: '/leaderboard',
      label: 'Leaderboard',
      icon: (
        <svg
          className="size-4"
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
    <header className="border-border/80 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6 lg:px-8">
        {/* Brand & Mission Identifier */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="group flex items-center gap-2.5">
            <span className="bg-cyan-accent flex size-2.5 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.8)] transition-transform group-hover:scale-125" />
            <div className="flex flex-col">
              <span className="text-cyan-accent font-mono text-[10px] font-semibold tracking-[0.2em] uppercase">
                ACN CYBER ODYSSEY
              </span>
              <span className="font-mono text-xs font-bold tracking-wider text-white">
                MISSION CONTROL
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="border-border/60 hidden items-center gap-1 border-l pl-4 md:flex">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs font-semibold transition-all ${
                    isActive
                      ? 'border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                      : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Identity & Sign Out */}
        <div className="flex items-center gap-3">
          {teamName && (
            <div className="border-border/60 hidden flex-col border-r pr-3 text-right font-mono text-xs lg:flex">
              <span className="text-foreground max-w-[140px] truncate font-semibold">
                {teamName}
              </span>
              <span className="text-[10px] font-bold text-cyan-400">{teamCode}</span>
            </div>
          )}

          <div className="flex flex-col text-right font-mono text-xs">
            <span className="text-foreground font-semibold">@{username}</span>
            <span className="text-muted-foreground text-[10px]">PARTICIPANT</span>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              className="border-border/70 bg-card/60 text-muted-foreground hover:border-border hover:bg-card focus-visible:ring-cyan-accent rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors hover:text-rose-300 focus-visible:ring-1 focus-visible:outline-none"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {/* Mobile Navigation Bar */}
      <nav className="border-border/50 bg-background/95 flex items-center justify-around border-t px-2 py-1.5 md:hidden">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-mono text-xs font-medium transition-colors ${
                isActive
                  ? 'border border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
