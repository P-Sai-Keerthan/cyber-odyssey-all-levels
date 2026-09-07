import Image from 'next/image';

interface AuthVisualProps {
  className?: string;
}

/**
 * Cyber Odyssey - TRACE Visual & Promotional Identity Panel.
 *
 * Provides a high-impact, intentionally framed presentation of the official
 * Cyber Odyssey event artwork with ambient cyber lighting and HUD telemetry.
 *
 * ---------------------------------------------------------------------------
 * ARTWORK SIZING & PROPORTIONS
 * ---------------------------------------------------------------------------
 * The artwork container uses responsive flex sizing (`flex-1 min-h-0`) inside
 * a full-height viewport column. Using `object-contain` preserves the exact
 * 877x767 aspect ratio without cropping, distortion, or horizontal overflow,
 * while allowing the poster to expand to fill the majority of the panel height
 * and width.
 *
 * ---------------------------------------------------------------------------
 * RESPONSIVE PERFORMANCE & MOBILE STRATEGY
 * ---------------------------------------------------------------------------
 * Hidden below `lg` breakpoint where authentication forms have single-column
 * priority. Desktop retains fast zero-CLS rendering with responsive sizes.
 */
export function AuthVisual({ className }: AuthVisualProps) {
  return (
    <aside
      aria-label="Cyber Odyssey Visual"
      className={`border-border/50 relative hidden w-full overflow-hidden border-l bg-[#060913] p-5 select-none lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col lg:justify-between lg:p-6 xl:p-8 2xl:p-10 ${className ?? ''}`}
    >
      {/* Ambient Cyber Lighting Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(6,182,212,0.12),rgba(217,70,239,0.06)_40%,transparent_70%)]"
      />

      {/* Top HUD Telemetry / Event ID Header */}
      <div className="border-border/30 text-muted-foreground/80 relative z-10 flex shrink-0 items-center justify-between border-b pb-3 font-mono text-[10px]">
        <div className="flex items-center gap-2">
          <span className="text-cyan-accent font-semibold tracking-widest">{'//'} EVENT-ID:</span>
          <span className="text-foreground/90 font-bold tracking-wider">CYBER_ODYSSEY_V2</span>
        </div>
        <div className="text-cyan-accent/80 flex items-center gap-1.5">
          <span className="bg-cyan-accent/80 size-1.5 animate-ping rounded-full" />
          <span className="font-semibold tracking-widest">MISSION_ACTIVE</span>
        </div>
      </div>

      {/* Center Artwork Showcase Frame (Dominant Focal Point) */}
      <div className="relative z-10 my-3 flex min-h-0 w-full flex-1 items-center justify-center xl:my-4">
        <div className="relative flex h-full max-h-[76vh] w-full items-center justify-center rounded-2xl border border-cyan-500/20 bg-black/40 p-2 shadow-[0_0_40px_-10px_rgba(6,182,212,0.18)] backdrop-blur-md sm:p-3 xl:p-4">
          {/* Cyber Corner HUD Brackets */}
          <span
            aria-hidden="true"
            className="absolute top-2 left-2 size-2.5 rounded-tl-sm border-t-2 border-l-2 border-cyan-400/70"
          />
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 size-2.5 rounded-tr-sm border-t-2 border-r-2 border-cyan-400/70"
          />
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-2 size-2.5 rounded-bl-sm border-b-2 border-l-2 border-cyan-400/70"
          />
          <span
            aria-hidden="true"
            className="absolute right-2 bottom-2 size-2.5 rounded-br-sm border-r-2 border-b-2 border-cyan-400/70"
          />

          {/* Responsive Poster Canvas */}
          <div className="relative h-full min-h-0 w-full">
            <Image
              src="/images/cyber-odyssey-auth.jpg"
              alt="ACN Cyber Odyssey event poster: a cloaked investigator before an archway overlooking a red moon."
              fill
              sizes="(min-width: 1024px) 52vw, 0px"
              className="object-contain object-center transition-transform duration-500 ease-out hover:scale-[1.01]"
            />
          </div>
        </div>
      </div>

      {/* Bottom Identity & Event Tagline Section */}
      <div className="border-border/30 relative z-10 shrink-0 space-y-2 border-t pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-0.5 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
            <span className="text-cyan-accent font-mono text-xs font-bold tracking-[0.25em] uppercase">
              TRACE
            </span>
          </div>
          <span className="text-muted-foreground/60 font-mono text-[9px] tracking-wider uppercase">
            INVESTIGATION_PROTOCOL
          </span>
        </div>

        <p className="text-muted-foreground/95 max-w-lg text-xs leading-relaxed font-normal xl:text-sm">
          &ldquo;Every trace tells a story. Follow the evidence. Uncover the truth.&rdquo;
        </p>

        <p className="text-muted-foreground/45 font-mono text-[9px] tracking-wider uppercase">
          AMRITA CYBER NATION {'//'} SECURE WORKSPACE GATEWAY
        </p>
      </div>
    </aside>
  );
}
