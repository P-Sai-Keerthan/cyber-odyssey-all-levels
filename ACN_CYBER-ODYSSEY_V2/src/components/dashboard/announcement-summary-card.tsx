import * as React from 'react';
import Link from 'next/link';
import { formatShortTime } from '@/lib/utils/date-formatter';

export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: string;
  createdAt: Date;
}

export interface AnnouncementSummaryCardProps {
  latestAnnouncement?: AnnouncementItem | null | undefined;
  unreadCount?: number | undefined;
}

export function AnnouncementSummaryCard({
  latestAnnouncement,
  unreadCount = 0,
}: AnnouncementSummaryCardProps) {
  return (
    <div className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
      <div className="border-border/50 flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
          <span className="size-2 rounded-full bg-cyan-400" />
          <span>ANNOUNCEMENTS</span>
        </div>
        {unreadCount > 0 && (
          <span className="rounded-md border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
            {unreadCount} NEW
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            LATEST OFFICIAL UPDATE
          </span>
          {latestAnnouncement ? (
            <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-3.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="line-clamp-1 font-bold text-white">
                  {latestAnnouncement.title}
                </span>
                <span className="ml-2 shrink-0 text-[10px] text-cyan-400">
                  {formatShortTime(latestAnnouncement.createdAt)}
                </span>
              </div>
              <p className="text-muted-foreground line-clamp-2 text-[11px] leading-relaxed">
                {latestAnnouncement.content}
              </p>
            </div>
          ) : (
            <div className="border-border/40 bg-background/30 text-muted-foreground rounded-xl border border-dashed p-4 text-center font-mono text-xs">
              No active announcements broadcasted yet.
            </div>
          )}
        </div>
      </div>

      <Link
        href="/announcements"
        className="group border-border/70 bg-card focus-visible:ring-cyan-accent flex items-center justify-between rounded-xl border px-4 py-2.5 font-mono text-xs font-semibold text-cyan-300 transition-all hover:border-cyan-500/50 hover:bg-cyan-950/30 focus-visible:ring-1 focus-visible:outline-none"
      >
        <span>READ ANNOUNCEMENTS</span>
        <span className="transition-transform group-hover:translate-x-1">→</span>
      </Link>
    </div>
  );
}
