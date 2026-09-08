'use client';

import * as React from 'react';
import { LevelTimer, type LevelTimerStatus } from '@/components/event/level-timer';
import { formatDateTime } from '@/lib/utils/date-formatter';
import type { SubmissionResponseData } from '@/lib/actions/submission-actions';
import type { Level3Progress } from '@/lib/level3/scoring';
import type { Level3ScoreSummary } from '@/lib/level3/score-summary';

export interface Level3SampleReport {
  isAvailable: boolean;
  originalName?: string | undefined;
}

export interface Level3WorkspaceProps {
  teamName: string;
  progress: Level3Progress;
  initialSubmission?: SubmissionResponseData | null | undefined;
  status: LevelTimerStatus | string;
  startedAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  pausedAt?: string | null | undefined;
  remainingSeconds?: number | undefined;
  durationMinutes?: number | undefined;
  name?: string | undefined;
  codename?: string | undefined;
  points?: string | undefined;
  windowOpen?: boolean | undefined;
  evaluationScore?: number | null | undefined;
  evaluationStatus?: string | null | undefined;
  evaluationFeedback?: string | null | undefined;
  approvalStatus?: string | null | undefined;
  rejectionReason?: string | null | undefined;
  sampleReport?: Level3SampleReport | undefined;
  /**
   * The whole Level 3 ceiling, read from the database on the server.
   *
   * Required in practice — the default below exists only so a test can mount the
   * workspace without a database. Every figure rendered in the scoring panel
   * comes from here; none is a literal in this file.
   */
  scoring?: Level3ScoreSummary | undefined;
  // Backwards-compatible props
  brief?: string | undefined;
  submissionInstructions?: string | undefined;
  initialUnlockedHints?: Record<string, string> | undefined;
}

/**
 * Level 3 Navigation: strictly four sections.
 * Stations, Evidence Package, Evidence Files, Dossier Index are strictly omitted.
 */
type NavSection = 'BRIEF' | 'PROTOCOL' | 'SCORING' | 'SUBMISSION';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: string }> = [
  { id: 'BRIEF', label: 'MISSION BRIEF', icon: '🎯' },
  { id: 'PROTOCOL', label: 'INVESTIGATION PROTOCOL', icon: '📋' },
  { id: 'SCORING', label: 'HOW SCORING WORKS', icon: '⚡' },
  { id: 'SUBMISSION', label: 'FINAL SUBMISSION', icon: '📝' },
];

/**
 * Used only when the workspace is mounted without a `scoring` prop — a unit test
 * rendering the component in isolation. Every real render passes the database
 * figures down from the page. Kept deliberately obvious rather than zeroed so a
 * missing prop shows up as wrong numbers rather than as a blank panel.
 */
const FALLBACK_SCORING: Level3ScoreSummary = {
  track1Points: 3500,
  track2Points: 6500,
  track2Released: false,
  availableDiscoveryPoints: 3500,
  reportPoints: 200,
  responsePoints: 0,
  evaluatedPoints: 200,
  availableTotalPoints: 3700,
  fullTotalPoints: 6700,
  targetIp: null,
  criteriaConfigured: false,
};

/** The six-step Level 3 flow, strictly in order. */
const PROTOCOL_STEPS = [
  {
    step: '01',
    title: 'ACCESS THE TARGET APPLICATION / ENVIRONMENT',
    desc: 'Establish secure connectivity to the challenge environment. Verify baseline availability of target web endpoints and inspect operational parameters.',
  },
  {
    step: '02',
    title: 'RECONNAISSANCE & ATTACK SURFACE MAPPING',
    desc: 'Map exposed services, undocumented routes, API endpoints, hidden parameters, and technology stacks across the target application footprint.',
  },
  {
    step: '03',
    title: 'VULNERABILITY IDENTIFICATION & EXPLOITATION',
    desc: 'Identify security flaws including access control weaknesses, injection flaws, authentication lapses, and logic bypasses. Confirm exploitability through controlled execution.',
  },
  {
    step: '04',
    title: 'EVIDENCE COLLECTION & IMPACT VALIDATION',
    desc: 'Capture definitive evidence: HTTP request/response transcripts, screenshots, payload executions, session tokens, and data extraction artifacts demonstrating business impact.',
  },
  {
    step: '05',
    title: 'ROOT CAUSE ANALYSIS & MITIGATION STRATEGY',
    desc: 'Diagnose the underlying code or configuration failure. Formulate defense-in-depth remediations, patch recommendations, and detection signatures.',
  },
  {
    step: '06',
    title: 'FINAL REPORT COMPILATION & SUBMISSION',
    desc: 'Compile your complete investigation dossier into an executive-ready PDF or Word document. Package technical appendices and submit through the terminal.',
  },
] as const;

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.zip'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface StagedFile {
  file: File;
  replacesId?: string;
}

type TerminalState = 'LOCKED' | 'UPLOADING' | 'FAILED' | 'RECEIVED' | 'FILES_READY' | 'NO_FILES';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fileIcon(name: string): string {
  return name.toLowerCase().endsWith('.zip') ? '📦' : '📄';
}

function TerminalBadge({ state }: { state: TerminalState }) {
  switch (state) {
    case 'LOCKED':
      return (
        <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-0.5 text-[10px] font-bold text-zinc-400">
          SUBMISSIONS LOCKED
        </span>
      );
    case 'UPLOADING':
      return (
        <span className="animate-pulse rounded-full border border-cyan-500/50 bg-cyan-950/60 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
          TRANSMITTING DELIVERABLES...
        </span>
      );
    case 'FAILED':
      return (
        <span className="rounded-full border border-rose-500/50 bg-rose-950/60 px-2.5 py-0.5 text-[10px] font-bold text-rose-300">
          TRANSMISSION ERROR
        </span>
      );
    case 'RECEIVED':
      return (
        <span className="rounded-full border border-emerald-500/50 bg-emerald-950/60 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
          DELIVERABLES RECEIVED
        </span>
      );
    case 'FILES_READY':
      return (
        <span className="rounded-full border border-amber-500/50 bg-amber-950/60 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
          FILES STAGED FOR SUBMISSION
        </span>
      );
    case 'NO_FILES':
    default:
      return (
        <span className="border-border/80 bg-background/60 text-muted-foreground rounded-full border px-2.5 py-0.5 text-[10px] font-bold">
          NO DELIVERABLES SUBMITTED
        </span>
      );
  }
}

function readError(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return body.error;
  }
  return fallback;
}

function readSubmission(body: unknown): SubmissionResponseData | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    'submission' in body &&
    typeof body.submission === 'object' &&
    body.submission !== null
  ) {
    return body.submission as SubmissionResponseData;
  }
  return null;
}

export function Level3Workspace({
  teamName,
  progress,
  initialSubmission = null,
  status = 'LIVE',
  startedAt = null,
  endsAt = null,
  pausedAt = null,
  remainingSeconds = 9000,
  durationMinutes = 150,
  name = 'Level 3 — The Twelve Axes',
  codename = 'THE TWELVE AXES',
  // Fallback only; every real render passes the configured figure. See
  // FALLBACK_SCORING for why this is a plausible number rather than a blank.
  points = '3,700 PTS',
  windowOpen = true,
  evaluationScore = null,
  evaluationStatus = null,
  evaluationFeedback = null,
  approvalStatus = null,
  rejectionReason = null,
  sampleReport = { isAvailable: false },
  scoring = FALLBACK_SCORING,
}: Level3WorkspaceProps) {
  const [activeSection, setActiveSection] = React.useState<NavSection>('BRIEF');
  const [submission, setSubmission] = React.useState<SubmissionResponseData | null>(
    initialSubmission,
  );

  const [staged, setStaged] = React.useState<StagedFile[]>([]);
  const [terminal, setTerminal] = React.useState<'idle' | 'uploading' | 'failed'>('idle');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [busyFileId, setBusyFileId] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = React.useRef<string | null>(null);

  const [isTimeExpired, setIsTimeExpired] = React.useState<boolean>(() => {
    return (
      status === 'COMPLETED' || (status === 'LIVE' && remainingSeconds <= 0 && Boolean(endsAt))
    );
  });

  const isLevelPaused = status === 'PAUSED';

  const storedFiles = React.useMemo(() => submission?.files ?? [], [submission]);

  const replacedIds = React.useMemo(
    () =>
      new Set(
        staged
          .map((s) => s.replacesId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    [staged],
  );

  const keepIds = React.useMemo(
    () => storedFiles.filter((f) => !replacedIds.has(f.id)).map((f) => f.id),
    [storedFiles, replacedIds],
  );

  const attachedAfterSubmit = keepIds.length + staged.length;

  const lockedByEvaluator =
    submission?.status === 'UNDER_REVIEW' || submission?.status === 'ACCEPTED';
  const isClosed = isTimeExpired || !windowOpen || isLevelPaused;
  const canWrite = !isClosed && !lockedByEvaluator;

  const isEvaluatedAndApproved =
    approvalStatus === 'APPROVED' && evaluationScore !== null && evaluationScore !== undefined;
  const isUnderReview =
    submission?.status === 'UNDER_REVIEW' ||
    evaluationStatus === 'IN_REVIEW' ||
    evaluationStatus === 'EVALUATED';
  const isReturned =
    submission?.status === 'REJECTED' ||
    evaluationStatus === 'RETURNED' ||
    approvalStatus === 'REJECTED';

  const terminalState: TerminalState = !canWrite
    ? 'LOCKED'
    : terminal === 'uploading'
      ? 'UPLOADING'
      : terminal === 'failed'
        ? 'FAILED'
        : staged.length > 0
          ? 'FILES_READY'
          : submission
            ? 'RECEIVED'
            : 'NO_FILES';

  // File validation
  function rejectionFor(file: File): string | null {
    if (file.size === 0) {
      return `"${file.name}" is empty (0 bytes). Check it opens on your device and attach it again.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `"${file.name}" is ${formatBytes(file.size)}, over the 20 MB limit per file. Compress it or split the evidence across several files.`;
    }
    const dot = file.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `"${file.name}" is not an accepted format (${ext || 'no extension'}). Attach a PDF, Word document or ZIP package.`;
    }
    return null;
  }

  function stageFiles(list: FileList | null) {
    const replacesId = replaceTargetRef.current;
    replaceTargetRef.current = null;

    if (!list || list.length === 0) return;
    setErrorMsg(null);
    setNotice(null);

    const incoming: StagedFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (!file) continue;

      const rejection = rejectionFor(file);
      if (rejection) {
        setErrorMsg(rejection);
        return;
      }

      incoming.push(replacesId && incoming.length === 0 ? { file, replacesId } : { file });
    }

    setStaged((prev) => {
      const seen = new Set(prev.map((s) => `${s.file.name}:${s.file.size}`));
      const additions = incoming.filter(
        (s) => s.replacesId || !seen.has(`${s.file.name}:${s.file.size}`),
      );
      const superseded = new Set(
        additions.map((s) => s.replacesId).filter((id): id is string => Boolean(id)),
      );
      const kept = prev.filter((s) => !s.replacesId || !superseded.has(s.replacesId));
      return [...kept, ...additions];
    });

    if (terminal === 'failed') setTerminal('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function openPicker(replacesId?: string) {
    replaceTargetRef.current = replacesId ?? null;
    fileInputRef.current?.click();
  }

  function unstage(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
    setErrorMsg(null);
  }

  async function removeStoredFile(fileId: string) {
    if (!canWrite || busyFileId) return;
    setBusyFileId(fileId);
    setErrorMsg(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/event/level-3/submission/files/${fileId}`, {
        method: 'DELETE',
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorMsg(readError(body, 'The file could not be removed. Please try again.'));
        return;
      }

      const next = readSubmission(body);
      if (next) setSubmission(next);
      setNotice('File removed from your submission.');
    } catch {
      setErrorMsg(
        'The file could not be removed because the request did not reach the portal. Check your connection and try again.',
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (terminal === 'uploading' || !canWrite) return;

    setErrorMsg(null);
    setNotice(null);

    if (attachedAfterSubmit === 0) {
      setErrorMsg(
        'Attach at least one deliverable — a PDF, Word document or ZIP package — before submitting.',
      );
      return;
    }

    setTerminal('uploading');

    try {
      const form = new FormData();
      for (const id of keepIds) form.append('keepFileIds', id);
      for (const item of staged) form.append('files', item.file);

      const res = await fetch('/api/event/level-3/submission', {
        method: 'POST',
        body: form,
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setTerminal('failed');
        setErrorMsg(
          readError(
            body,
            res.status === 413
              ? 'That upload is larger than the portal accepts. Keep each file under 20 MB.'
              : 'Your investigation could not be submitted. Please try again.',
          ),
        );
        return;
      }

      const next = readSubmission(body);
      if (next) {
        setSubmission(next);
      }
      setStaged([]);
      setTerminal('idle');
      setNotice(
        res.status === 201
          ? 'Investigation submitted. You may keep updating it until the deadline.'
          : 'Investigation updated. Your latest version is the one that will be judged.',
      );
    } catch {
      setTerminal('failed');
      setErrorMsg(
        'The submission did not reach the portal, so nothing was saved. Check your connection and try again.',
      );
    }
  }

  // Scoring calculations
  const bugDiscoveryPoints = progress.discoveryPoints ?? 0;
  const hintPenalties = progress.penaltyPoints;
  const netDiscoveryPoints = Math.max(0, bugDiscoveryPoints - hintPenalties);
  const approvedScore = evaluationScore ?? 0;
  const totalCombinedScore = netDiscoveryPoints + approvedScore;

  return (
    <div className="space-y-6">
      {/* 1. HEADER: authoritative mission clock (Matches Level 2 style) */}
      <LevelTimer
        levelNumber={3}
        name={name}
        codename={codename}
        status={(status as LevelTimerStatus) || 'LOCKED'}
        startedAt={startedAt}
        endsAt={endsAt}
        pausedAt={pausedAt}
        remainingSeconds={remainingSeconds}
        durationMinutes={durationMinutes}
        points={points}
        description="Web security investigation. Execute the investigation protocol, uncover vulnerabilities on the challenge target, and compile the final report."
        variant="workspace"
        onExpire={() => setIsTimeExpired(true)}
      />

      {isLevelPaused && (
        <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-6 text-center font-mono">
          <div className="text-sm font-bold text-amber-300">
            ⏸ LEVEL PAUSED // WAIT FOR FURTHER INSTRUCTIONS
          </div>
          <p className="text-muted-foreground font-sans text-xs">
            Operations desk has paused Level 3. Timers are held until marshals resume the session.
          </p>
        </div>
      )}

      {isTimeExpired && (
        <div className="space-y-2 rounded-2xl border border-rose-500/40 bg-rose-950/40 p-6 text-center font-mono">
          <div className="text-sm font-bold text-rose-300">
            ⚠️ LEVEL 3 TIMEFRAME CONCLUDED // SUBMISSIONS CLOSED
          </div>
          <p className="text-muted-foreground font-sans text-xs">
            The Level 3 submission deadline has passed. No further changes can be made.
          </p>
        </div>
      )}

      {/* 2. WORKSPACE GRID: Strictly 4 Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT: Navigation Rail (3 columns) */}
        <div className="lg:col-span-3">
          <div className="border-border/80 bg-card/60 sticky top-6 space-y-2 rounded-2xl border p-3 font-mono text-xs shadow-xl backdrop-blur-md">
            <div className="border-border/40 border-b px-3 py-2">
              <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                LEVEL 3 NAVIGATION
              </span>
            </div>

            <nav className="flex flex-col gap-1" aria-label="Level 3 Workspace Navigation">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={activeSection === item.id ? 'page' : undefined}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left font-bold transition-all ${
                    activeSection === item.id
                      ? 'border border-cyan-500/50 bg-cyan-950/60 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)]'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </nav>

            {/* Quick Status Pill */}
            <div className="border-border/40 border-t px-3 pt-3">
              <div className="text-muted-foreground text-[10px] uppercase">DELIVERABLE STATUS</div>
              <div className="mt-1">
                <TerminalBadge state={terminalState} />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Section Content (9 columns) */}
        <div className="space-y-6 font-mono text-xs lg:col-span-9">
          {/* SECTION 1: MISSION BRIEF */}
          {activeSection === 'BRIEF' && (
            <section className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-xl backdrop-blur-md md:p-8">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                <div>
                  <span className="text-xs font-bold tracking-widest text-cyan-300 uppercase">
                    MISSION BRIEF // THE TWELVE AXES
                  </span>
                  <h2 className="mt-0.5 text-xl font-black tracking-wide text-white">
                    OPERATION DEEP PRISM
                  </h2>
                </div>
                <span className="rounded border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 text-[10px] font-bold text-cyan-300">
                  CLASSIFIED // SQUAD: {teamName.toUpperCase()}
                </span>
              </div>

              {/* High-level Narrative */}
              <div className="text-muted-foreground space-y-3 leading-relaxed">
                <p>
                  The forensics conducted during the Nexora Technologies investigation uncovered an
                  external orchestration nexus codenamed{' '}
                  <strong className="text-white">&ldquo;The Twelve Axes&rdquo;</strong>.
                  Intelligence confirms this external target infrastructure is currently
                  operational, hosting high-value web services used by threat actors to coordinate
                  intrusion campaigns.
                </p>
                <p className="text-foreground/90 font-medium">
                  Your squad is tasked with conducting a full-scope security investigation against
                  the challenge target: map exposed attack surfaces, exploit security
                  vulnerabilities, gather reproducible evidence, and formulate defense-in-depth
                  mitigations.
                </p>
              </div>

              {/* Investigation Scope & Context Card */}
              <div className="border-border/60 bg-background/60 space-y-4 rounded-xl border p-5">
                <div className="flex items-center gap-2">
                  <span className="size-2 animate-pulse rounded-full bg-cyan-400" />
                  <span className="text-foreground text-xs font-bold tracking-wider uppercase">
                    TARGET CONTEXT & INVESTIGATION SCOPE
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
                  {/*
                    TARGET IP ADDRESS — Creator-configured, read from Level3Config
                    on the server. Never a literal in this file: the address moves
                    between rehearsal and event day, and sometimes during the
                    event, and a redeploy is not available at that point.
                  */}
                  <div
                    className="border-border/40 bg-card/40 rounded-lg border p-3 md:col-span-2"
                    data-testid="level3-target-ip-panel"
                  >
                    <span className="mb-1 block font-bold text-cyan-400">TARGET IP ADDRESS</span>
                    {scoring.targetIp ? (
                      <span
                        data-testid="level3-target-ip"
                        className="text-base font-black tracking-wider text-white tabular-nums"
                      >
                        {scoring.targetIp}
                      </span>
                    ) : (
                      <span className="text-muted-foreground leading-relaxed">
                        Not yet assigned. The event command team publishes the target address before
                        the level opens &mdash; watch the announcements feed.
                      </span>
                    )}
                  </div>
                  <div className="border-border/40 bg-card/40 rounded-lg border p-3">
                    <span className="mb-1 block font-bold text-cyan-400">
                      TARGET INFRASTRUCTURE
                    </span>
                    <span className="text-muted-foreground leading-relaxed">
                      Production web applications, microservices, and external API interfaces
                      deployed within the designated challenge target perimeter.
                    </span>
                  </div>
                  <div className="border-border/40 bg-card/40 rounded-lg border p-3">
                    <span className="mb-1 block font-bold text-cyan-400">
                      AUTHORIZED RECON VECTORS
                    </span>
                    <span className="text-muted-foreground leading-relaxed">
                      Authentication bypasses, injection vulnerabilities, broken access controls,
                      server-side logic flaws, and remote command executions.
                    </span>
                  </div>
                </div>
              </div>

              {/* Operational Objectives */}
              <div className="border-border/60 bg-background/50 space-y-3 rounded-xl border p-5">
                <span className="text-foreground block text-xs font-bold tracking-wider uppercase">
                  OPERATIONAL OBJECTIVES
                </span>
                <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-cyan-400">01.</span>
                    <span className="text-muted-foreground">
                      Systematically map external attack surfaces and undocumented endpoints.
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-cyan-400">02.</span>
                    <span className="text-muted-foreground">
                      Identify exploitable security vulnerabilities across target web services.
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-cyan-400">03.</span>
                    <span className="text-muted-foreground">
                      Demonstrate controlled exploitability with captured technical artifacts.
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-cyan-400">04.</span>
                    <span className="text-muted-foreground">
                      Document root-cause analyses and engineer actionable defense patches.
                    </span>
                  </div>
                </div>
              </div>

              {/* Direct Web Investigation Callout */}
              <div className="flex items-start gap-3 rounded-xl border border-cyan-500/40 bg-cyan-950/30 p-4 text-xs leading-relaxed text-cyan-200">
                <span className="shrink-0 text-base" aria-hidden="true">
                  🌐
                </span>
                <div>
                  <strong className="mb-0.5 block text-white">
                    DIRECT WEB SECURITY INVESTIGATION
                  </strong>
                  Level 3 requires direct interaction and verification against the live challenge
                  target. Probe the target services with precision, observe HTTP request/response
                  behaviors, and test your hypotheses directly in the target environment.
                </div>
              </div>

              {/* Report Importance Callout */}
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs leading-relaxed text-amber-200">
                <span className="shrink-0 text-base" aria-hidden="true">
                  ⚠️
                </span>
                <div>
                  <strong className="mb-0.5 block text-white">
                    CRITICAL REQUIREMENT: FINAL INVESTIGATION REPORT
                  </strong>
                  {/*
                    The literal "up to 1000 base points" stood here — a hardcoded
                    evaluator ceiling on a participant's page, and wrong besides:
                    Level 3 is configured at 400. Removed rather than re-pointed
                    at the configuration, for the same reason as the "Evaluator
                    scored" cards. What a squad needs from this paragraph is that
                    the report is required and what it must contain.
                  */}
                  Vulnerability discovery alone is not enough. The evaluation jury assesses your
                  comprehensive Final Report. It must contain clear step-by-step reproduction steps,
                  proof-of-concept payloads, impact assessments, and remediation strategies.
                </div>
              </div>
            </section>
          )}

          {/* SECTION 2: INVESTIGATION PROTOCOL */}
          {activeSection === 'PROTOCOL' && (
            <section className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-xl backdrop-blur-md md:p-8">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                <div>
                  <span className="text-xs font-bold tracking-widest text-cyan-300 uppercase">
                    INVESTIGATION PROTOCOL // EXECUTION FLOW
                  </span>
                  <h2 className="mt-0.5 text-xl font-black tracking-wide text-white">
                    STANDARD 6-STEP METHODOLOGY
                  </h2>
                </div>
                <span className="rounded border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 text-[10px] font-bold text-cyan-300">
                  STANDARD OPERATING PROCEDURE
                </span>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                Follow this structured six-stage methodology to methodically progress from initial
                target connectivity to final jury report delivery. Each step is vital for uncovering
                high-severity findings and documenting rigorous evidence.
              </p>

              <ol className="space-y-4">
                {PROTOCOL_STEPS.map((item, index) => (
                  <li
                    key={item.step}
                    className="border-border/60 bg-background/60 relative flex items-start gap-4 rounded-xl border p-4.5 transition-all hover:border-cyan-500/40"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/60 font-mono text-xs font-black text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.15)]"
                    >
                      {item.step}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-bold tracking-wide text-white">{item.title}</div>
                      <div className="text-muted-foreground text-xs leading-relaxed">
                        {item.desc}
                      </div>
                    </div>
                    {index < PROTOCOL_STEPS.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-3 left-[2.1rem] h-3 w-px bg-cyan-500/30"
                      />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* SECTION 3: HOW SCORING WORKS */}
          {activeSection === 'SCORING' && (
            <section className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-xl backdrop-blur-md md:p-8">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                <div>
                  <span className="text-xs font-bold tracking-widest text-cyan-300 uppercase">
                    SCORING ARCHITECTURE // DYNAMIC EVALUATION
                  </span>
                  <h2 className="mt-0.5 text-xl font-black tracking-wide text-white">
                    HOW SCORING WORKS
                  </h2>
                </div>
                <span className="rounded border border-amber-500/40 bg-amber-950/50 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                  AUTHORITATIVE FORMULA
                </span>
              </div>

              {/* Master Formula Display Banner */}
              <div className="to-background/90 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-cyan-950/40 p-5 shadow-[0_0_25px_rgba(245,158,11,0.1)]">
                <div className="mb-2 text-[10px] font-bold tracking-widest text-amber-400 uppercase">
                  LEVEL 3 SCORING FORMULA
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-black text-white sm:text-base">
                  <span className="rounded border border-cyan-500/40 bg-cyan-950/80 px-2.5 py-1 text-cyan-300">
                    Bug Discovery Points
                  </span>
                  <span className="font-mono text-lg text-amber-400">−</span>
                  <span className="rounded border border-rose-500/40 bg-rose-950/80 px-2.5 py-1 text-rose-300">
                    Hint Penalties
                  </span>
                  <span className="font-mono text-lg text-amber-400">+</span>
                  <span className="rounded border border-emerald-500/40 bg-emerald-950/80 px-2.5 py-1 text-emerald-300">
                    Approved Final Report Score
                  </span>
                  <span className="font-mono text-lg text-amber-400">=</span>
                  <span className="rounded border border-amber-400 bg-amber-500/20 px-3 py-1 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]">
                    Total Level 3 Score
                  </span>
                </div>

                {/* Live Calculated Score Bar */}
                <div className="border-border/40 mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Bug Discoveries
                    </span>
                    <span className="text-sm font-bold text-cyan-300">
                      +{bugDiscoveryPoints} PTS
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Hint Deductions
                    </span>
                    <span className="text-sm font-bold text-rose-400">-{hintPenalties} PTS</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Approved Report
                    </span>
                    <span className="text-sm font-bold text-emerald-300">
                      {isEvaluatedAndApproved ? `+${approvedScore} PTS` : 'PENDING'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Current Level 3 Score
                    </span>
                    <span className="text-sm font-black text-amber-300">
                      {totalCombinedScore} PTS
                    </span>
                  </div>
                </div>
              </div>

              {/*
                AVAILABLE SCORE — the ceiling, distinct from what the squad has
                EARNED. Every figure is read from the database: the two track
                ceilings from Level3Config, Report and Response from the keyed
                Level 3 evaluation criteria. Nothing here is a literal.

                Track 2 is CUMULATIVE. Releasing it REPLACES the Track 1 ceiling
                rather than adding to it, which is why the two are shown as a
                progression with one of them dimmed, and why the total uses
                `availableDiscoveryPoints` and never a sum.
              */}
              <div
                className="border-border/60 bg-background/50 space-y-4 rounded-xl border p-5"
                data-testid="level3-available-score"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground text-xs font-bold tracking-wider uppercase">
                    AVAILABLE SCORE // LEVEL 3 PROGRESSION
                  </span>
                  <span
                    className={`rounded border px-2.5 py-1 text-[10px] font-bold ${
                      scoring.track2Released
                        ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                        : 'border-border bg-background/60 text-muted-foreground'
                    }`}
                  >
                    {scoring.track2Released ? 'TRACK 2 RELEASED' : 'TRACK 2 NOT YET RELEASED'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/* TRACK 1 */}
                  <div
                    className={`rounded-lg border p-3 ${
                      scoring.track2Released
                        ? 'border-border/40 bg-card/30'
                        : 'border-cyan-500/40 bg-cyan-950/30'
                    }`}
                  >
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Track 1
                    </span>
                    <span className="text-muted-foreground block text-[10px]">
                      Before Track 2 release
                    </span>
                    <span
                      data-testid="level3-track1-points"
                      className={`mt-1 block text-xl font-black tabular-nums ${
                        scoring.track2Released ? 'text-muted-foreground' : 'text-cyan-300'
                      }`}
                    >
                      {scoring.track1Points.toLocaleString()} PTS
                    </span>
                  </div>

                  {/* TRACK 2 — cumulative */}
                  <div
                    className={`rounded-lg border p-3 ${
                      scoring.track2Released
                        ? 'border-cyan-500/40 bg-cyan-950/30'
                        : 'border-border/40 bg-card/30'
                    }`}
                  >
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Track 2 Release
                    </span>
                    <span className="text-muted-foreground block text-[10px]">
                      Updated available score
                    </span>
                    <span
                      data-testid="level3-track2-points"
                      className={`mt-1 block text-xl font-black tabular-nums ${
                        scoring.track2Released ? 'text-cyan-300' : 'text-muted-foreground'
                      }`}
                    >
                      {scoring.track2Points.toLocaleString()} PTS
                    </span>
                  </div>

                  {/*
                    The two "Evaluator scored" cards that stood here — FINAL
                    REPORT and LEVEL 3 RESPONSE, each advertising the ceiling an
                    evaluator can award — have been removed.

                    They were an internal rubric summary on a participant's page:
                    a squad reading "LEVEL 3 RESPONSE / Evaluator scored / 200
                    PTS" learns nothing it can act on, and the figure invites
                    being read as a score already awarded. The evaluated
                    component is still explained in prose below, and the score
                    itself is untouched in the database — it reaches the squad
                    through the approved-evaluation panel and the leaderboard,
                    which is where a result belongs.
                  */}
                </div>

                <div className="border-border/40 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <p className="text-muted-foreground max-w-xl text-[11px] leading-relaxed">
                    Track 2 is <strong className="text-white">cumulative</strong> &mdash; when it is
                    released the {scoring.track2Points.toLocaleString()} PTS figure{' '}
                    <strong className="text-white">replaces</strong> Track 1 rather than adding to
                    it. Your final report is assessed separately and requires Admin approval before
                    it reaches the leaderboard.
                  </p>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Discovery Points Available
                    </span>
                    {/*
                      The DISCOVERY ceiling, not the level total. The evaluated
                      portion is deliberately not added in here: this panel now
                      describes what a squad can earn by finding bugs, which is
                      the part they control from this page.
                    */}
                    <span
                      data-testid="level3-available-total"
                      className="block text-2xl font-black text-amber-300 tabular-nums"
                    >
                      {scoring.availableDiscoveryPoints.toLocaleString()} PTS
                    </span>
                  </div>
                </div>
              </div>

              {/* Real Database Dynamic Findings Stats */}
              <div className="border-border/60 bg-background/50 space-y-3 rounded-xl border p-5">
                <div className="flex items-center justify-between">
                  <span className="text-foreground text-xs font-bold tracking-wider uppercase">
                    SQUAD VERIFICATION STATS (LIVE DATABASE)
                  </span>
                  <span className="text-muted-foreground text-[10px]">REAL-TIME TELEMETRY</span>
                </div>

                {progress.verifiedBugCount > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="border-border/40 bg-card/60 rounded-lg border p-3 text-center">
                      <span className="text-muted-foreground block text-[10px] uppercase">
                        Bugs Discovered
                      </span>
                      <span className="text-xl font-black text-cyan-300">
                        {progress.verifiedBugCount} / {progress.totalActiveBugs || '—'}
                      </span>
                    </div>
                    <div className="border-border/40 bg-card/60 rounded-lg border p-3 text-center">
                      <span className="text-muted-foreground block text-[10px] uppercase">
                        Gross Discovery Pts
                      </span>
                      <span className="text-xl font-black text-cyan-300">
                        +{bugDiscoveryPoints} PTS
                      </span>
                    </div>
                    <div className="border-border/40 bg-card/60 rounded-lg border p-3 text-center">
                      <span className="text-muted-foreground block text-[10px] uppercase">
                        Hints Claimed
                      </span>
                      <span className="text-xl font-black text-rose-400">
                        {progress.hintsUsed} (-{hintPenalties} PTS)
                      </span>
                    </div>
                    <div className="border-border/40 bg-card/60 rounded-lg border p-3 text-center">
                      <span className="text-muted-foreground block text-[10px] uppercase">
                        Net Discovery Score
                      </span>
                      <span className="text-xl font-black text-emerald-400">
                        {netDiscoveryPoints} PTS
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="border-border/40 bg-card/30 rounded-xl border border-dashed p-4 text-center">
                    <span className="mb-1 block text-xs font-bold text-amber-300 uppercase">
                      NO LIVE VULNERABILITIES LOGGED YET // AWAITING TARGET VERIFICATION
                    </span>
                    <p className="text-muted-foreground mx-auto max-w-lg text-xs">
                      Vulnerability findings and automated flag submissions from the challenge
                      target stream directly into this console upon verification. Begin recon and
                      exploitation on the target to log points.
                    </p>
                  </div>
                )}
              </div>

              {/* Three Explanation Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* 1. Vulnerability Discoveries */}
                <div className="border-border/60 bg-card/50 space-y-2 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-cyan-400" />
                    <span className="text-xs font-bold text-white uppercase">
                      1. VULNERABILITY DISCOVERY
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Vulnerabilities discovered and confirmed on the challenge target earn dynamic
                    bug bounty points based on severity tiers (Low, Medium, High, Critical).
                    Verification occurs automatically through platform integrations.
                  </p>
                </div>

                {/* 2. Hint Deductions */}
                <div className="border-border/60 bg-card/50 space-y-2 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-rose-400" />
                    <span className="text-xs font-bold text-white uppercase">
                      2. HINT DEDUCTIONS
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Hints provide guidance on complex attack vectors, parameter names, or
                    exploitation bypasses. Unlocking hints applies tiered penalty point deductions
                    directly against your gross discovery points.
                  </p>
                </div>

                {/* 3. Final Report Evaluation */}
                <div className="border-border/60 bg-card/50 space-y-2 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-bold text-white uppercase">
                      3. FINAL REPORT EVALUATION
                    </span>
                  </div>
                  {/*
                    Deliberately no point ceilings here. What a participant needs
                    from this card is WHAT is assessed and WHEN it counts; the
                    rubric's maximum is the evaluator's working figure, and
                    printing it on a squad's page is the internal-summary problem
                    the "Evaluator scored" cards had.
                  */}
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Your final investigation report is assessed by an evaluator on reproduction
                    clarity, evidence artifacts, root-cause depth and the mitigations you propose.
                    An Admin verifies that assessment before it is published to the leaderboard.
                    Your approved result appears under{' '}
                    <strong className="text-white">Final Submission</strong> once that happens.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 4: FINAL SUBMISSION */}
          {activeSection === 'SUBMISSION' && (
            <div className="space-y-6">
              {/* Top Banner: Evaluation Status Panel */}
              <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
                <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📝</span>
                    <span className="text-xs font-bold text-white uppercase">
                      FINAL INVESTIGATION REPORT & EVALUATION STATUS
                    </span>
                  </div>
                  <TerminalBadge state={terminalState} />
                </div>

                {/* Evaluation State Presentation */}
                {isEvaluatedAndApproved ? (
                  <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                        <span className="text-sm font-black tracking-wide text-emerald-300">
                          EVALUATION APPROVED BY ADMIN
                        </span>
                      </div>
                      <span className="text-xl font-black text-emerald-300">
                        {evaluationScore} / {scoring.evaluatedPoints} PTS
                      </span>
                    </div>
                    {evaluationFeedback && (
                      <div className="text-foreground/90 border-t border-emerald-500/20 pt-2 text-xs">
                        <span className="mb-1 block font-bold text-emerald-400">
                          Jury Feedback:
                        </span>
                        <p className="whitespace-pre-wrap">{evaluationFeedback}</p>
                      </div>
                    )}
                  </div>
                ) : isUnderReview ? (
                  <div className="space-y-1 rounded-xl border border-cyan-500/40 bg-cyan-950/30 p-4 text-xs text-cyan-200">
                    <span className="block font-bold text-cyan-300">
                      DELIVERABLES UNDER JURY REVIEW
                    </span>
                    <p className="text-muted-foreground">
                      Your investigation deliverables are actively being assessed by the evaluation
                      jury. Scores will be published to the official leaderboard following
                      administrative verification.
                    </p>
                  </div>
                ) : isReturned ? (
                  <div className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200">
                    <span className="block font-bold text-rose-300">
                      DELIVERABLES RETURNED FOR REVISION
                    </span>
                    <p className="text-muted-foreground">
                      The evaluation jury has requested revisions for your report. Update your
                      deliverables and re-upload before the level closes.
                    </p>
                    {rejectionReason && (
                      <p className="font-mono font-bold text-rose-300">
                        Reason: &ldquo;{rejectionReason}&rdquo;
                      </p>
                    )}
                  </div>
                ) : submission ? (
                  <div className="border-border/60 bg-background/50 space-y-1 rounded-xl border p-4 text-xs">
                    <span className="block font-bold text-white">
                      DELIVERABLES REGISTERED // ATTEMPT {submission.attemptCount ?? 1}
                    </span>
                    <p className="text-muted-foreground">
                      Submitted on {formatDateTime(submission.submittedAt)}. Your latest upload will
                      be graded once the jury begins reviews.
                    </p>
                  </div>
                ) : (
                  <div className="border-border/40 bg-background/30 text-muted-foreground rounded-xl border p-4 text-center text-xs">
                    No deliverables have been submitted yet. Use the upload terminal below to submit
                    your report.
                  </div>
                )}
              </div>

              {/* Grid: Guidelines & Resources (Left 5 cols) + Terminal (Right 7 cols) */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Guidelines & Resources (5 cols) */}
                <div className="space-y-6 lg:col-span-5">
                  {/*
                    SAMPLE REPORT — reference material, NOT the squad's submission.
                    The file is whatever the Creator published as the Level 3
                    SAMPLE_REPORT resource; this renders its real filename and
                    links to the authenticated streaming endpoint. When nothing is
                    published it shows a neutral state rather than a button that
                    would 404 — a dead download on the submission page reads as a
                    broken portal at exactly the wrong moment.
                  */}
                  <div
                    className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 shadow-xl backdrop-blur-md"
                    data-testid="level3-sample-report"
                  >
                    <div className="border-border/40 flex items-center justify-between border-b pb-3">
                      <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
                        SAMPLE REPORT
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          sampleReport?.isAvailable
                            ? 'border-cyan-500/40 bg-cyan-950/50 text-cyan-300'
                            : 'border-border bg-background/60 text-muted-foreground'
                        }`}
                      >
                        {sampleReport?.isAvailable ? 'AVAILABLE' : 'NOT PROVIDED'}
                      </span>
                    </div>

                    {sampleReport?.isAvailable ? (
                      <>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          A sample investigation report has been provided by the event command team.
                          Review it before preparing your final report &mdash; it is reference
                          material, not a template you are required to submit.
                        </p>
                        <a
                          href="/api/event/level-3/sample-report"
                          download={sampleReport.originalName || 'level3_sample_report.pdf'}
                          data-testid="level3-sample-report-link"
                          className="flex items-center justify-between rounded-xl border border-cyan-500/40 bg-cyan-950/40 p-3 transition-colors hover:bg-cyan-900/60"
                        >
                          <div className="min-w-0">
                            <span className="block text-xs font-bold text-cyan-300">
                              VIEW SAMPLE REPORT
                            </span>
                            <span className="text-muted-foreground block truncate text-[10px]">
                              {sampleReport.originalName || 'Official reference report'}
                            </span>
                          </div>
                          <span className="shrink-0 pl-3 text-xs font-bold text-cyan-300">
                            &darr; DOWNLOAD
                          </span>
                        </a>
                      </>
                    ) : (
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        <span className="text-foreground/90 block font-bold">
                          NO SAMPLE REPORT PROVIDED
                        </span>
                        The event command team has not published one for Level 3. Follow the report
                        guidelines below &mdash; they are the full requirement on their own.
                      </p>
                    )}
                  </div>

                  <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 shadow-xl backdrop-blur-md">
                    <div className="border-border/40 border-b pb-3">
                      <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
                        REPORT GUIDELINES
                      </span>
                    </div>

                    <div className="text-muted-foreground space-y-2.5 text-xs leading-relaxed">
                      <p>
                        Your report is the single source of truth for your squad&apos;s findings.
                        Ensure your document includes:
                      </p>
                      <ul className="text-foreground/90 list-inside list-disc space-y-1.5 pl-1">
                        <li>Executive Summary & Risk Assessment</li>
                        <li>Target Reconnaissance & Attack Surface Map</li>
                        <li>Detailed Vulnerability Breakdown & PoC Payloads</li>
                        <li>Step-by-step Reproduction Instructions</li>
                        <li>Root Cause Analysis & Defensive Mitigations</li>
                      </ul>
                    </div>

                    <div className="border-border/40 space-y-2 border-t pt-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Accepted Formats:</span>
                        <span className="font-bold text-white">PDF, Word (.docx, .doc), ZIP</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Maximum Size:</span>
                        <span className="font-bold text-cyan-300">20 MB per file</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submission Terminal (7 cols) */}
                <div className="space-y-6 lg:col-span-7">
                  <div className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 shadow-xl backdrop-blur-md">
                    <div className="border-border/40 flex items-center justify-between border-b pb-3">
                      <span className="text-xs font-bold tracking-widest text-cyan-400 uppercase">
                        DELIVERABLE TERMINAL
                      </span>
                      <span className="text-muted-foreground text-[10px]">LEVEL 3 SUBMISSION</span>
                    </div>

                    {/* Feedback Messages */}
                    {errorMsg && (
                      <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs font-bold text-rose-300">
                        {errorMsg}
                      </div>
                    )}
                    {notice && (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs font-bold text-emerald-300">
                        {notice}
                      </div>
                    )}

                    {/* Hidden Native File Input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPTED_EXTENSIONS.join(',')}
                      onChange={(e) => stageFiles(e.target.files)}
                      className="hidden"
                    />

                    {/* Drag and Drop Zone */}
                    {canWrite && (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDragOver(true);
                        }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragOver(false);
                          stageFiles(e.dataTransfer.files);
                        }}
                        onClick={() => openPicker()}
                        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                          isDragOver
                            ? 'border-cyan-400 bg-cyan-950/40'
                            : 'border-border/80 bg-background/50 hover:bg-background/80 hover:border-cyan-500/60'
                        }`}
                      >
                        <div className="mb-1 text-2xl">📤</div>
                        <div className="text-xs font-bold text-white">
                          DRAG & DROP DELIVERABLES HERE, OR{' '}
                          <span className="text-cyan-400 underline">BROWSE</span>
                        </div>
                        <div className="text-muted-foreground mt-1 text-[10px]">
                          PDF, DOCX, DOC, or ZIP • Max 20 MB per file
                        </div>
                      </div>
                    )}

                    {/* Staged Files List (files chosen locally) */}
                    {staged.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-muted-foreground block text-[10px] font-bold tracking-wider uppercase">
                          STAGED FILES ({staged.length}) — READY TO UPLOAD
                        </span>
                        <div className="space-y-2">
                          {staged.map((s, idx) => (
                            <div
                              key={`${s.file.name}-${idx}`}
                              className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs"
                            >
                              <div className="flex items-center gap-2.5 truncate">
                                <span>{fileIcon(s.file.name)}</span>
                                <span className="truncate font-bold text-white">{s.file.name}</span>
                                <span className="text-muted-foreground text-[10px]">
                                  ({formatBytes(s.file.size)})
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => unstage(idx)}
                                className="ml-2 shrink-0 text-xs font-bold text-rose-400 hover:text-rose-300"
                              >
                                REMOVE
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Stored Files (already received by server) */}
                    {storedFiles.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-muted-foreground block text-[10px] font-bold tracking-wider uppercase">
                          STORED DELIVERABLES ON SERVER ({storedFiles.length})
                        </span>
                        <div className="space-y-2">
                          {storedFiles.map((file) => (
                            <div
                              key={file.id}
                              className="border-border/80 bg-background/70 flex items-center justify-between rounded-xl border p-3 text-xs"
                            >
                              <div className="flex items-center gap-2.5 truncate">
                                <span>{fileIcon(file.originalName)}</span>
                                <span className="truncate font-bold text-white">
                                  {file.originalName}
                                </span>
                                <span className="text-muted-foreground text-[10px]">
                                  ({formatBytes(file.fileSize)})
                                </span>
                              </div>

                              <div className="ml-2 flex shrink-0 items-center gap-2">
                                {canWrite && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openPicker(file.id)}
                                      disabled={busyFileId === file.id}
                                      className="text-[11px] font-bold text-cyan-400 hover:underline"
                                    >
                                      REPLACE
                                    </button>
                                    {storedFiles.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => removeStoredFile(file.id)}
                                        disabled={busyFileId === file.id}
                                        className="text-[11px] font-bold text-rose-400 hover:underline"
                                      >
                                        DELETE
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Button */}
                    {canWrite && (
                      <form onSubmit={handleSubmit} className="pt-2">
                        <button
                          type="submit"
                          disabled={terminal === 'uploading' || attachedAfterSubmit === 0}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400 bg-cyan-500 px-6 py-3 font-mono text-xs font-black text-black shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all hover:bg-cyan-400 disabled:opacity-50"
                        >
                          {terminal === 'uploading'
                            ? 'UPLOADING DELIVERABLES...'
                            : submission
                              ? 'UPDATE DELIVERABLES'
                              : 'SUBMIT FINAL INVESTIGATION REPORT'}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
