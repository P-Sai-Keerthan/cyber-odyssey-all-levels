import * as React from 'react';

export function TacticalBriefing() {
  return (
    <section
      aria-labelledby="tactical-briefing-title"
      className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md sm:p-8"
    >
      {/* Header Document Badge */}
      <div className="border-border/60 flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
            <span className="size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
            <span>OPERATIONAL DIRECTIVE // CLASSIFICATION: PARTICIPANT</span>
          </div>
          <h2
            id="tactical-briefing-title"
            className="text-xl font-bold tracking-tight text-white sm:text-2xl"
          >
            TACTICAL BRIEFING
          </h2>
          <p className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            Investigation Protocols & Rules
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1 font-mono text-[10px] font-bold text-cyan-300">
            DOC ID: CO-TB-2026
          </span>
          <span className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-1 font-mono text-[10px] font-bold text-emerald-300">
            STATUS: ACTIVE
          </span>
        </div>
      </div>

      {/* 3 Main Tactical Sections */}
      <div className="grid grid-cols-1 gap-6 font-mono text-xs md:grid-cols-3">
        {/* 1. Investigation Protocols */}
        <div className="border-border/60 bg-background/50 space-y-3.5 rounded-xl border p-4.5">
          <div className="border-border/40 flex items-center gap-2 border-b pb-2.5">
            <span className="flex size-5 items-center justify-center rounded border border-cyan-500/40 bg-cyan-950/80 text-[10px] font-bold text-cyan-300">
              01
            </span>
            <h3 className="font-bold tracking-wide text-cyan-200 uppercase">
              Investigation Protocols
            </h3>
          </div>
          <ul className="text-muted-foreground space-y-2.5 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-cyan-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Squad Sync:</strong> All puzzle answers,
                forensic hashes, and flags submitted by any squad member automatically sync to the
                team record.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Signal Decryption:</strong> Evidence must be
                inspected through provided logs, packet captures, and reverse engineering files.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Linear Progression:</strong> Unlocking
                subsequent challenge sectors requires validating prerequisite forensic checkpoints.
              </span>
            </li>
          </ul>
        </div>

        {/* 2. Competition Rules */}
        <div className="border-border/60 bg-background/50 space-y-3.5 rounded-xl border p-4.5">
          <div className="border-border/40 flex items-center gap-2 border-b pb-2.5">
            <span className="flex size-5 items-center justify-center rounded border border-amber-500/40 bg-amber-950/80 text-[10px] font-bold text-amber-300">
              02
            </span>
            <h3 className="font-bold tracking-wide text-amber-200 uppercase">Competition Rules</h3>
          </div>
          <ul className="text-muted-foreground space-y-2.5 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-amber-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Zero Outside Help:</strong> Sharing flags,
                payloads, or answers across rival squads is strictly monitored and leads to
                disqualification.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Anti-Tampering:</strong> Attacking the Cyber
                Odyssey scoring infrastructure or marshaling network triggers immediate ban.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Rate Limits:</strong> Brute force submissions
                against flag endpoints are rate limited and logged into the audit ledger.
              </span>
            </li>
          </ul>
        </div>

        {/* 3. Important Instructions */}
        <div className="border-border/60 bg-background/50 space-y-3.5 rounded-xl border p-4.5">
          <div className="border-border/40 flex items-center gap-2 border-b pb-2.5">
            <span className="flex size-5 items-center justify-center rounded border border-fuchsia-500/40 bg-fuchsia-950/80 text-[10px] font-bold text-fuchsia-300">
              03
            </span>
            <h3 className="font-bold tracking-wide text-fuchsia-200 uppercase">
              Important Instructions
            </h3>
          </div>
          <ul className="text-muted-foreground space-y-2.5 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-fuchsia-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Command Desk:</strong> Technical discrepancies
                or platform anomalies should be escalated directly to on-site Event Marshals.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-fuchsia-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Submission Deadline:</strong> All investigation
                flags must be submitted before the countdown timer hits 00:00:00.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-fuchsia-400 select-none">•</span>
              <span>
                <strong className="text-foreground">Tie-Breaker:</strong> Tied scores are resolved
                deterministically by earliest verified timestamp of final submission.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
