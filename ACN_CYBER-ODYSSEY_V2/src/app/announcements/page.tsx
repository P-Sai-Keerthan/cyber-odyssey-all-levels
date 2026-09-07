import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireParticipant } from '@/lib/auth/guards';
import { ParticipantShell } from '@/components/participant/participant-shell';
import { TacticalBriefing } from '@/components/participant/tactical-briefing';
import { formatDate, formatShortTime } from '@/lib/utils/date-formatter';
import { listVisibleAnnouncements } from '@/lib/event/announcements';

export const metadata: Metadata = {
  title: 'Announcements & Tactical Briefing',
  description: 'Official event announcements, live bulletins, and operational investigation rules.',
};

export default async function AnnouncementsPage() {
  const user = await requireParticipant();

  if (!user.membership) {
    redirect('/team/onboarding');
  }

  const team = user.membership.team;

  // SEC-17-04: audience filtering lives in one place so the feed and the sidebar
  // badge can never disagree about what this participant is allowed to see.
  const announcements = await listVisibleAnnouncements('PARTICIPANT');

  return (
    <ParticipantShell
      username={user.username}
      teamName={team.name}
      unreadAnnouncementsCount={announcements.length > 0 ? announcements.length : undefined}
    >
      {/* Header Intel Bar */}
      <div className="border-border/80 bg-card/60 space-y-3 rounded-2xl border p-6 shadow-2xl backdrop-blur-md sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
              <span className="size-2 rounded-full bg-cyan-400" />
              <span>OFFICIAL OPERATIONS BROADCAST</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              ANNOUNCEMENTS
            </h1>
            <p className="text-muted-foreground text-sm">
              Official event communications from the Cyber Odyssey operations team.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3 py-1.5 font-bold text-cyan-300">
              {announcements.length} BROADCAST{announcements.length === 1 ? '' : 'S'}
            </span>
          </div>
        </div>
      </div>

      {/* Section 1: Official Announcements Feed */}
      <section className="space-y-4" aria-labelledby="official-announcements-heading">
        <div className="border-border/50 flex items-center justify-between border-b pb-2">
          <h2
            id="official-announcements-heading"
            className="font-mono text-xs font-bold tracking-wider text-cyan-400 uppercase"
          >
            Official Announcements
          </h2>
          <span className="text-muted-foreground font-mono text-[10px]">REAL-TIME DISPATCH</span>
        </div>

        {announcements.length === 0 ? (
          <div className="border-border/60 bg-card/40 space-y-3 rounded-2xl border p-12 text-center font-mono backdrop-blur-md">
            <div className="bg-card border-border text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-xl border">
              <svg
                className="size-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white uppercase">NO ACTIVE ANNOUNCEMENTS</h3>
            <p className="text-muted-foreground mx-auto max-w-sm text-xs">
              The operations desk has not published any broadcasts at this time. Check back during
              level transitions.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {announcements.map((announcement) => {
              const isHigh = announcement.priority === 'HIGH' || announcement.priority === 'URGENT';
              const isUrgent = announcement.priority === 'URGENT';

              return (
                <article
                  key={announcement.id}
                  className={`space-y-3 rounded-2xl border p-6 backdrop-blur-md transition-all ${
                    isUrgent
                      ? 'border-rose-500/50 bg-rose-950/20 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
                      : isHigh
                        ? 'border-amber-500/40 bg-amber-950/15 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
                        : 'border-border/80 bg-card/60'
                  }`}
                >
                  <div className="border-border/40 flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                          isUrgent
                            ? 'border-rose-500/40 bg-rose-950/60 text-rose-300'
                            : isHigh
                              ? 'border-amber-500/40 bg-amber-950/60 text-amber-300'
                              : 'border-cyan-500/40 bg-cyan-950/60 text-cyan-300'
                        }`}
                      >
                        {announcement.priority} PRIORITY
                      </span>

                      <span className="border-border/60 bg-background/50 text-muted-foreground rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase">
                        {announcement.category}
                      </span>
                    </div>

                    <time
                      dateTime={announcement.createdAt.toISOString()}
                      className="text-muted-foreground font-mono text-[11px]"
                    >
                      {formatDate(announcement.createdAt)} at{' '}
                      {formatShortTime(announcement.createdAt)}
                    </time>
                  </div>

                  <h3 className="text-base font-bold text-white sm:text-lg">
                    {announcement.title}
                  </h3>

                  <p className="text-muted-foreground font-mono text-xs leading-relaxed whitespace-pre-line">
                    {announcement.content}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Tactical Briefing — Investigation Protocols & Rules */}
      <TacticalBriefing />
    </ParticipantShell>
  );
}
