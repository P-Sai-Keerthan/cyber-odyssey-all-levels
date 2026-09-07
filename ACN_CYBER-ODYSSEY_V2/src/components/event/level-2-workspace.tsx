'use client';

import * as React from 'react';
import type { SubmissionResponseData } from '@/lib/actions/submission-actions';
import { GradientButton } from '@/components/ui/gradient-button';
import { LevelTimer, type LevelTimerStatus } from '@/components/event/level-timer';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface Level2WorkspaceProps {
  initialSubmission?: SubmissionResponseData | null | undefined;
  teamName: string;
  levelNumber?: number | undefined;
  scheduledTime?: string | undefined;
  duration?: string | undefined;
  durationMinutes?: number | undefined;
  points?: string | undefined;
  status?: LevelTimerStatus | string | undefined;
  startedAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  pausedAt?: string | null | undefined;
  remainingSeconds?: number | undefined;
  isExpired?: boolean | undefined;
  /**
   * Whether the SERVER currently accepts writes for this level.
   *
   * Distinct from the countdown: a level can be paused, completed or locked with
   * seconds still on the clock. This is the same `checkAuthoritativeLevelAccess`
   * verdict the submission API applies, handed to the UI so the two agree — but
   * the API re-checks it on every write, so this value only decides what is
   * disabled, never what is permitted.
   */
  windowOpen?: boolean | undefined;
  evaluationFeedback?: string | null | undefined;
  evaluationScore?: number | null | undefined;
  evaluationStatus?: string | null | undefined;
  evidenceResource?:
    | {
        isAvailable: boolean;
        originalName?: string | undefined;
        fileSize?: number | undefined;
      }
    | undefined;
  sampleReportResource?:
    | {
        isAvailable: boolean;
        originalName?: string | undefined;
        fileSize?: number | undefined;
      }
    | undefined;
}

/**
 * Dossier sections.
 *
 * CASE_INFO and SAMPLE_REPORT are gone. The first duplicated network detail the
 * evidence package itself carries; the second was a second submission-instruction
 * section sitting beside the guidelines, which meant a participant had to read
 * two places to learn one thing. The sample report DOWNLOAD survives inside
 * SUBMISSION — it is a published resource an operator can still publish or
 * withdraw, and deleting the only route to it would have broken that.
 */
type NavSection = 'BRIEF' | 'PROTOCOL' | 'EVIDENCE' | 'SUBMISSION';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: string }> = [
  { id: 'BRIEF', label: 'MISSION BRIEF', icon: '🎯' },
  { id: 'PROTOCOL', label: 'INVESTIGATION PROTOCOL', icon: '📋' },
  { id: 'EVIDENCE', label: 'EVIDENCE PACKAGE', icon: '📦' },
  { id: 'SUBMISSION', label: 'FINAL SUBMISSION', icon: '📝' },
];

/** The six-step flow, in order. Numbering here IS the sequence, not decoration. */
const PROTOCOL_STEPS = [
  {
    step: '01',
    title: 'UNLOCK THE CASE FILES',
    desc: 'Open the evidence package and unlock the protected case files to begin the investigation.',
  },
  {
    step: '02',
    title: 'INVESTIGATE THE DIGITAL EVIDENCE',
    desc: 'Work through employee records, system activity, emails and USB activity for anomalies.',
  },
  {
    step: '03',
    title: 'INVESTIGATE THE FORENSIC LAB',
    desc: 'Examine the physical evidence recovered from the scene and the lab findings that accompany it.',
  },
  {
    step: '04',
    title: 'ANALYSE THE CCTV FOOTAGE',
    desc: 'Place people and devices in time. The footage is what ties an account to a person.',
  },
  {
    step: '05',
    title: 'CONNECT THE EVIDENCE',
    desc: 'Build the timeline and correlate indicators across every source until one account holds.',
  },
  {
    step: '06',
    title: 'SUBMIT THE FINAL REPORT',
    desc: 'Attach your deliverables and submit your investigation report.',
  },
] as const;

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.zip'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** A file chosen in the browser but not yet sent to the server. */
interface StagedFile {
  file: File;
  /** Set when this file was picked via Replace on an already-submitted file. */
  replacesId?: string;
}

/**
 * The status shown on the submission terminal.
 *
 * These are the states the participant is told about, and each one corresponds
 * to something real: LOCKED means the server refuses writes, RECEIVED means a
 * submission is durable on the server, FAILED means a request came back with an
 * error. Nothing here is inferred from a hope — in particular "FILES READY"
 * never appears after a failed upload, which is what it used to do.
 */
type TerminalState = 'LOCKED' | 'UPLOADING' | 'FAILED' | 'RECEIVED' | 'FILES_READY' | 'NO_FILES';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fileIcon(name: string): string {
  return name.toLowerCase().endsWith('.zip') ? '📦' : '📄';
}

export function Level2Workspace({
  initialSubmission = null,
  teamName,
  levelNumber = 2,
  scheduledTime: _scheduledTime = '11:30 AM',
  duration: _duration = '02:00:00',
  durationMinutes = 120,
  points = '1000 PTS',
  status = 'LIVE',
  startedAt = null,
  endsAt = null,
  pausedAt = null,
  remainingSeconds = 7200,
  isExpired = false,
  windowOpen = true,
  evaluationFeedback = null,
  evaluationScore = null,
  evaluationStatus = null,
  evidenceResource = { isAvailable: true },
  sampleReportResource = { isAvailable: true },
}: Level2WorkspaceProps) {
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

  // One hidden input serves both "attach" and "replace". `replaceTargetRef`
  // carries which stored file the next pick is replacing, if any — an ordinary
  // ref rather than state because it is read once inside the change handler and
  // must not trigger a render of its own.
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = React.useRef<string | null>(null);

  const [isTimeExpired, setIsTimeExpired] = React.useState<boolean>(() => {
    return (
      isExpired ||
      status === 'COMPLETED' ||
      (status === 'LIVE' && remainingSeconds <= 0 && Boolean(endsAt))
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

  /** Stored files that will survive the next submit. */
  const keepIds = React.useMemo(
    () => storedFiles.filter((f) => !replacedIds.has(f.id)).map((f) => f.id),
    [storedFiles, replacedIds],
  );

  /** How many deliverables the submission will hold once this write lands. */
  const attachedAfterSubmit = keepIds.length + staged.length;

  // An evaluator holding the report is the one state a participant cannot write
  // through, deadline or not: replacing it would invalidate work in progress.
  const lockedByEvaluator =
    submission?.status === 'UNDER_REVIEW' || submission?.status === 'ACCEPTED';
  const isClosed = isTimeExpired || !windowOpen || isLevelPaused;
  const canWrite = !isClosed && !lockedByEvaluator;

  const isEvaluated =
    evaluationStatus === 'EVALUATED' || (evaluationScore !== null && evaluationScore !== undefined);
  const isUnderReview = submission?.status === 'UNDER_REVIEW' || evaluationStatus === 'IN_REVIEW';
  const isReturned = submission?.status === 'REJECTED' || evaluationStatus === 'RETURNED';

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

  // ---------------------------------------------------------------------------
  // File staging
  // ---------------------------------------------------------------------------

  /**
   * Client-side gate before a file is staged.
   *
   * A courtesy only. The server re-checks size and extension AND inspects the
   * file's leading bytes, because an extension is a claim the browser passes on
   * unverified — renaming `payload.exe` to `report.pdf` gets past everything
   * here and nothing there.
   */
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

      // A Replace pick applies to the first file chosen; anything else in the
      // same selection is staged as an ordinary addition.
      incoming.push(replacesId && incoming.length === 0 ? { file, replacesId } : { file });
    }

    setStaged((prev) => {
      // Dropping the same file twice is a slip, not an instruction to attach two
      // copies. A file staged as a replacement is exempt: it is meant to sit
      // beside the stored file it supersedes.
      const seen = new Set(prev.map((s) => `${s.file.name}:${s.file.size}`));
      const additions = incoming.filter(
        (s) => s.replacesId || !seen.has(`${s.file.name}:${s.file.size}`),
      );
      // One pending replacement per stored file.
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

  // ---------------------------------------------------------------------------
  // Server calls
  // ---------------------------------------------------------------------------

  /**
   * Removes a file the server already holds.
   *
   * A discrete request rather than a staged change: a squad that attached the
   * wrong file should be able to take it off without re-uploading the ones the
   * server already has, over a conference network, at a deadline.
   */
  async function removeStoredFile(fileId: string) {
    if (!canWrite || busyFileId) return;
    setBusyFileId(fileId);
    setErrorMsg(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/event/level-2/submission/files/${fileId}`, {
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

      // No Content-Type header on purpose: the browser has to set the multipart
      // boundary itself, and naming the type here would omit it.
      const res = await fetch('/api/event/level-2/submission', {
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

  // ---------------------------------------------------------------------------

  const statusBadge = <TerminalBadge state={terminalState} />;

  return (
    <div className="space-y-6">
      {/* ===================================================================== */}
      {/* 1. HEADER: authoritative mission clock                                */}
      {/* ===================================================================== */}
      <LevelTimer
        levelNumber={levelNumber}
        name="Level 2 — The Boar's Mark"
        codename="THE BOAR'S MARK"
        status={(status as LevelTimerStatus) || 'LOCKED'}
        startedAt={startedAt}
        endsAt={endsAt}
        pausedAt={pausedAt}
        remainingSeconds={remainingSeconds}
        durationMinutes={durationMinutes}
        points={points}
        description="Investigate the ORION data breach at Nexora Technologies: employee records, system activity, emails, USB activity, CCTV and physical evidence."
        variant="workspace"
        onExpire={() => setIsTimeExpired(true)}
      />

      {isLevelPaused && (
        <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-6 text-center font-mono">
          <div className="text-sm font-bold text-amber-300">
            ⏸ LEVEL PAUSED // WAIT FOR FURTHER INSTRUCTIONS
          </div>
          <p className="text-muted-foreground font-sans text-xs">
            Operations desk has paused Level 2. Timers are held until marshals resume the session.
          </p>
        </div>
      )}

      {isTimeExpired && (
        <div className="space-y-2 rounded-2xl border border-rose-500/40 bg-rose-950/40 p-6 text-center font-mono">
          <div className="text-sm font-bold text-rose-300">
            ⚠️ LEVEL 2 TIMEFRAME CONCLUDED // SUBMISSIONS CLOSED
          </div>
          <p className="text-muted-foreground font-sans text-xs">
            The Level 2 submission deadline has passed. No further changes can be made.
          </p>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. WORKSPACE                                                          */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* --------------------------------------------------------------- */}
        {/* LEFT: dossier index                                              */}
        {/* --------------------------------------------------------------- */}
        <div className="lg:col-span-3">
          <div className="border-border/80 bg-card/60 sticky top-6 space-y-2 rounded-2xl border p-3 font-mono text-xs shadow-xl backdrop-blur-md">
            <div className="border-border/40 border-b px-3 py-2">
              <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                CASE DOSSIER INDEX
              </span>
            </div>

            <nav className="flex flex-col gap-1">
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
          </div>
        </div>

        {/* --------------------------------------------------------------- */}
        {/* CENTRE: case dossier                                             */}
        {/* --------------------------------------------------------------- */}
        <div className="space-y-6 lg:col-span-5">
          {activeSection === 'BRIEF' && (
            <section className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 font-mono text-xs shadow-xl backdrop-blur-md">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <span className="font-bold text-cyan-300 uppercase">
                  MISSION BRIEF // THE BOAR&apos;S MARK
                </span>
                <span className="text-muted-foreground text-[10px]">CASE #BM-2026-X</span>
              </div>

              <div className="text-muted-foreground space-y-3 leading-relaxed">
                <p>
                  Nexora Technologies has suffered a serious{' '}
                  <strong className="text-white">ORION</strong> data breach. Your team must
                  investigate employee records, system activity, emails, USB activity, CCTV, and
                  physical evidence.
                </p>
                <p className="text-foreground/90">
                  Build the timeline. Connect the clues. Find the truth.
                </p>
              </div>

              <div className="border-border/60 bg-background/50 space-y-3 rounded-xl border p-4">
                <span className="text-foreground text-[11px] font-bold uppercase">
                  YOUR MISSION
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  Identify who stole the ORION data and prove your conclusion with evidence.
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-cyan-300">
                  <span>Observe</span>
                  <span className="text-muted-foreground">→</span>
                  <span>Investigate</span>
                  <span className="text-muted-foreground">→</span>
                  <span>Connect</span>
                  <span className="text-muted-foreground">→</span>
                  <span>Decide</span>
                  <span className="text-muted-foreground">→</span>
                  <span>Report</span>
                </div>
              </div>

              {/* The dependency is stated; which answer opens which file is not.
                  Naming that here would hand out Level 1 for free. */}
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-[11px] leading-relaxed text-amber-200">
                <span aria-hidden="true">🔑</span>
                <span>Some of the file passwords are answers of Level 1.</span>
              </div>
            </section>
          )}

          {activeSection === 'PROTOCOL' && (
            <section className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 font-mono text-xs shadow-xl backdrop-blur-md">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <span className="font-bold text-cyan-300 uppercase">
                  STANDARD INVESTIGATION PROTOCOL
                </span>
                <span className="text-muted-foreground text-[10px]">6-STEP SEQUENCE</span>
              </div>

              <ol className="space-y-3">
                {PROTOCOL_STEPS.map((item, index) => (
                  <li
                    key={item.step}
                    className="border-border/50 bg-background/50 relative flex items-start gap-3 rounded-xl border p-3.5"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-950/50 font-mono text-[11px] font-black text-cyan-300"
                    >
                      {item.step}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-bold text-white">{item.title}</div>
                      <div className="text-muted-foreground text-[11px] leading-relaxed">
                        {item.desc}
                      </div>
                    </div>
                    {/* The connector makes the order readable at a glance. Purely
                        decorative, so it is hidden from assistive technology —
                        the list element already carries the sequence. */}
                    {index < PROTOCOL_STEPS.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2 left-[1.85rem] h-2 w-px bg-cyan-500/30"
                      />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {activeSection === 'EVIDENCE' && (
            <section className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 font-mono text-xs shadow-xl backdrop-blur-md">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden="true">
                    📦
                  </span>
                  <span className="font-bold text-white uppercase">
                    EVIDENCE PACKAGE // CASE FILE
                  </span>
                </div>
                <span className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-[9px] font-bold text-emerald-300">
                  VERIFIED ARCHIVE
                </span>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                The case package holds the employee records, system and email activity, USB logs,
                CCTV footage and physical-evidence scans collected at Nexora Technologies. Some of
                the files inside are password protected.
              </p>

              {evidenceResource.isAvailable ? (
                <div className="border-border/40 bg-background/50 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="truncate font-bold text-white">
                      {evidenceResource.originalName || 'cyber_odyssey_level2_evidence.zip'}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {evidenceResource.fileSize
                        ? `${formatBytes(evidenceResource.fileSize)} • `
                        : ''}
                      Official Case Package
                    </div>
                  </div>

                  <a
                    href="/api/event/level-2/evidence"
                    download={evidenceResource.originalName || 'cyber_odyssey_level2_evidence.zip'}
                    className="inline-block shrink-0"
                  >
                    <GradientButton
                      variant="cyan"
                      size="sm"
                      className="font-mono text-xs font-semibold uppercase"
                    >
                      ↓ Download Evidence ZIP
                    </GradientButton>
                  </a>
                </div>
              ) : (
                <div className="border-border/40 bg-background/30 space-y-2 rounded-xl border border-dashed p-6 text-center">
                  <span className="text-muted-foreground block font-mono text-xs font-bold tracking-wider uppercase">
                    NOT AVAILABLE // EVIDENCE PACKAGE NOT CURRENTLY PUBLISHED
                  </span>
                  <p className="text-muted-foreground text-[11px]">
                    The operations team has not currently published an active evidence package for
                    this phase. Check announcements for dispatch notices.
                  </p>
                </div>
              )}
            </section>
          )}

          {activeSection === 'SUBMISSION' && (
            <section className="border-border/80 bg-card/60 space-y-5 rounded-2xl border p-6 font-mono text-xs shadow-xl backdrop-blur-md">
              <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <span className="font-bold text-cyan-300 uppercase">
                  FINAL INVESTIGATION SUBMISSION
                </span>
                <span className="text-muted-foreground text-[10px]">WHAT IS EXPECTED</span>
              </div>

              <div className="space-y-2">
                <span className="text-foreground text-[11px] font-bold uppercase">
                  Submission Guidelines
                </span>
                <ul className="text-muted-foreground space-y-1.5 text-[11px] leading-relaxed">
                  <li>
                    • Support your conclusion using evidence collected during the investigation.
                  </li>
                  <li>• Connect evidence from multiple sources.</li>
                  <li>
                    • Include relevant timestamps, IP addresses, accounts, devices, activity, and
                    other forensic indicators.
                  </li>
                  <li>• Do not make unsupported conclusions.</li>
                </ul>
              </div>

              <div className="border-border/60 bg-background/50 text-muted-foreground space-y-1.5 rounded-xl border p-4 text-[11px]">
                <span className="text-foreground block font-bold uppercase">Accepted formats</span>
                <div>• PDF document (.pdf) — recommended</div>
                <div>• Word document (.docx, .doc)</div>
                <div>• Supporting ZIP bundle (.zip)</div>
                <div>• Maximum size: 20 MB per file</div>
              </div>

              {/* The sample report stays reachable from here. It is a resource an
                  operator publishes or withdraws, and this is now its only route. */}
              {sampleReportResource.isAvailable && (
                <div className="border-border/40 bg-background/50 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="truncate font-bold text-white">
                      {sampleReportResource.originalName ||
                        'cyber_odyssey_level2_sample_report.pdf'}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {sampleReportResource.fileSize
                        ? `${formatBytes(sampleReportResource.fileSize)} • `
                        : ''}
                      Reference format — do not submit it as your own work
                    </div>
                  </div>

                  <a
                    href="/api/event/level-2/sample-report"
                    download={
                      sampleReportResource.originalName || 'cyber_odyssey_level2_sample_report.pdf'
                    }
                    className="inline-block shrink-0"
                  >
                    <GradientButton
                      variant="outline"
                      size="sm"
                      className="font-mono text-xs font-semibold uppercase"
                    >
                      ↓ Sample Report
                    </GradientButton>
                  </a>
                </div>
              )}
            </section>
          )}
        </div>

        {/* --------------------------------------------------------------- */}
        {/* RIGHT: submission terminal                                       */}
        {/* --------------------------------------------------------------- */}
        <div className="lg:col-span-4">
          {/*
            NOT sticky, and not height-constrained.

            The card that used to live here was `sticky top-6` with no bound on
            its height. Once it holds a status banner, an upload zone, a file
            list and a 50-word answer field it is taller than the viewport, and a
            sticky element taller than its scrollport pins its top and pushes its
            own footer off the bottom — which is exactly the clipped deadline
            notice the layout was reported for. Letting the column scroll with
            the page costs nothing and cannot clip.
          */}
          <div className="border-border/80 bg-card/60 flex flex-col gap-5 rounded-2xl border p-5 font-mono text-xs shadow-2xl backdrop-blur-md sm:p-6">
            {/* Header */}
            <div className="border-border/40 flex flex-wrap items-start justify-between gap-3 border-b pb-4">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-widest text-cyan-400 uppercase">
                  <span className="size-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
                  <span>FINAL INVESTIGATION</span>
                </div>
                <h3 className="text-base font-bold text-white uppercase">
                  {canWrite ? 'SUBMIT / UPDATE' : 'SUBMISSION LOCKED'}
                </h3>
              </div>
              {statusBadge}
            </div>

            {/* Status / error messages */}
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-[11px] leading-relaxed break-words text-rose-200"
              >
                {errorMsg}
              </div>
            )}

            {notice && !errorMsg && (
              <div
                role="status"
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-[11px] leading-relaxed break-words text-emerald-200"
              >
                {notice}
              </div>
            )}

            {isReturned && (
              <div className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4">
                <div className="text-[11px] font-bold text-rose-300 uppercase">
                  ⚠️ DELIVERABLES RETURNED FOR REVISION
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed break-words">
                  {evaluationFeedback ||
                    'An evaluator requested revisions. Review the requirements and submit again.'}
                </p>
              </div>
            )}

            {isEvaluated && (
              <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-emerald-300 uppercase">
                  <span>✓ EVALUATION COMPLETE</span>
                  {evaluationScore !== null && evaluationScore !== undefined && (
                    <span className="text-sm font-black text-amber-300">{evaluationScore} PTS</span>
                  )}
                </div>
                {evaluationFeedback && (
                  <p className="text-muted-foreground text-[11px] leading-relaxed break-words">
                    &quot;{evaluationFeedback}&quot;
                  </p>
                )}
              </div>
            )}

            {isUnderReview && !isEvaluated && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 text-[11px] text-blue-200">
                🔍 An evaluator is reviewing your investigation. It cannot be changed while they
                hold it.
              </div>
            )}

            {/* Current submission receipt */}
            {submission && (
              <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold tracking-wider text-cyan-300 uppercase">
                    CURRENT SUBMISSION
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    ATTEMPT {submission.attemptCount ?? 1}
                  </span>
                </div>
                <dl className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">SQUAD</dt>
                    <dd className="truncate font-bold text-white">{teamName}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">LAST UPDATED</dt>
                    <dd className="text-foreground text-right">
                      {formatDateTime(submission.submittedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* Files the server holds */}
            {storedFiles.length > 0 && (
              <div className="space-y-2">
                <span className="text-muted-foreground block text-[10px] font-bold uppercase">
                  SUBMITTED DELIVERABLES ({storedFiles.length})
                </span>
                <ul className="space-y-1.5">
                  {storedFiles.map((f) => {
                    const pendingReplacement = replacedIds.has(f.id);
                    return (
                      <li
                        key={f.id}
                        className={`border-border/60 flex flex-col gap-2 rounded-xl border p-3 ${
                          pendingReplacement ? 'bg-amber-950/20 opacity-70' : 'bg-cyan-950/20'
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="text-cyan-400" aria-hidden="true">
                            {fileIcon(f.originalName)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-[11px] font-semibold break-all text-white"
                              title={f.originalName}
                            >
                              {f.originalName}
                            </div>
                            <div className="text-muted-foreground text-[10px]">
                              {formatBytes(f.fileSize)}
                              {pendingReplacement && ' • will be replaced when you submit'}
                            </div>
                          </div>
                        </div>

                        {canWrite && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openPicker(f.id)}
                              disabled={busyFileId !== null || terminal === 'uploading'}
                              className="rounded-lg border border-cyan-500/40 px-2.5 py-1 text-[10px] font-bold tracking-wider text-cyan-300 uppercase transition-colors hover:bg-cyan-950/50 disabled:opacity-40"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeStoredFile(f.id)}
                              disabled={busyFileId !== null || terminal === 'uploading'}
                              className="text-muted-foreground rounded-lg border border-rose-500/30 px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-40"
                            >
                              {busyFileId === f.id ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* One input serves attach and replace. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/zip"
              onChange={(e) => stageFiles(e.target.files)}
              className="hidden"
            />

            {canWrite ? (
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {/* Upload area */}
                <div className="space-y-2">
                  <span className="text-muted-foreground block text-[10px] font-bold tracking-wider uppercase">
                    ATTACH DELIVERABLES (PDF / DOCX / ZIP)
                  </span>

                  <button
                    type="button"
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
                    className={`border-border/70 group flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all focus-visible:border-cyan-400 focus-visible:outline-none ${
                      isDragOver
                        ? 'border-cyan-400 bg-cyan-950/40'
                        : 'bg-background/40 hover:bg-card/80 hover:border-cyan-500/60'
                    }`}
                  >
                    <span
                      className="text-muted-foreground text-2xl group-hover:text-cyan-300"
                      aria-hidden="true"
                    >
                      📁
                    </span>
                    <span className="mt-1 text-xs font-bold text-white">
                      Click or drag investigation files here
                    </span>
                    <span className="text-muted-foreground mt-0.5 text-[10px]">
                      PDF, DOCX, or ZIP (Max 20MB per file)
                    </span>
                  </button>
                </div>

                {/* Staged deliverables */}
                {staged.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-muted-foreground block text-[10px] font-bold uppercase">
                      STAGED DELIVERABLES ({staged.length})
                    </span>
                    <ul className="space-y-1.5">
                      {staged.map((item, idx) => (
                        <li
                          key={`${item.file.name}-${item.file.size}-${idx}`}
                          className="border-border/60 bg-background/60 flex flex-col gap-2 rounded-xl border p-3"
                        >
                          <div className="flex min-w-0 items-start gap-2">
                            <span className="text-sm text-cyan-400" aria-hidden="true">
                              {fileIcon(item.file.name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div
                                className="text-[11px] font-semibold break-all text-white"
                                title={item.file.name}
                              >
                                {item.file.name}
                              </div>
                              <div className="text-muted-foreground text-[10px]">
                                {formatBytes(item.file.size)}
                                {item.replacesId
                                  ? ' • replaces a submitted file'
                                  : ' • not yet uploaded'}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openPicker(item.replacesId)}
                              disabled={terminal === 'uploading'}
                              className="rounded-lg border border-cyan-500/40 px-2.5 py-1 text-[10px] font-bold tracking-wider text-cyan-300 uppercase transition-colors hover:bg-cyan-950/50 disabled:opacity-40"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => unstage(idx)}
                              disabled={terminal === 'uploading'}
                              className="text-muted-foreground rounded-lg border border-rose-500/30 px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Submit + deadline note. Inside the flex column, so the card
                    grows to fit them instead of pushing them past its edge. */}
                <div className="border-border/40 space-y-2 border-t pt-4">
                  <GradientButton
                    type="submit"
                    variant="cyan"
                    size="default"
                    disabled={terminal === 'uploading' || attachedAfterSubmit === 0}
                    className="w-full text-xs font-bold tracking-wider uppercase disabled:opacity-50"
                  >
                    {terminal === 'uploading' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span
                          className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent"
                          aria-hidden="true"
                        />
                        <span>UPLOADING…</span>
                      </span>
                    ) : submission ? (
                      'UPDATE INVESTIGATION →'
                    ) : (
                      'SUBMIT INVESTIGATION →'
                    )}
                  </GradientButton>

                  <p className="text-muted-foreground text-center text-[10px] leading-relaxed">
                    You may replace files and resubmit your investigation until your squad&apos;s
                    submission deadline. All squad members share one submission — the latest version
                    is the one that gets judged.
                  </p>
                </div>
              </form>
            ) : (
              <div className="border-border/40 bg-background/40 space-y-2 rounded-xl border p-4 text-center">
                <div className="text-[11px] font-bold tracking-wider text-rose-300 uppercase">
                  SUBMISSION LOCKED
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {lockedByEvaluator
                    ? 'An evaluator has picked up your submission, so it can no longer be changed.'
                    : isLevelPaused
                      ? 'Level 2 is paused. Editing reopens when the operations desk resumes the session.'
                      : 'The Level 2 submission deadline has passed. No further changes can be made.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalBadge({ state }: { state: TerminalState }) {
  const styles: Record<TerminalState, { label: string; className: string }> = {
    LOCKED: {
      label: 'SUBMISSION LOCKED',
      className: 'border-rose-500/50 bg-rose-950/50 text-rose-300',
    },
    UPLOADING: {
      label: 'UPLOADING…',
      className: 'border-blue-500/50 bg-blue-950/50 text-blue-300',
    },
    FAILED: {
      label: 'UPLOAD FAILED',
      className: 'border-rose-500/50 bg-rose-950/50 text-rose-300',
    },
    RECEIVED: {
      label: 'SUBMISSION RECEIVED',
      className: 'border-emerald-500/50 bg-emerald-950/50 text-emerald-300',
    },
    FILES_READY: {
      label: 'FILES READY',
      className: 'border-amber-500/50 bg-amber-950/50 text-amber-300',
    },
    NO_FILES: {
      label: 'NO FILES ATTACHED',
      className: 'border-border bg-background/60 text-muted-foreground',
    },
  };

  const { label, className } = styles[state];
  return (
    <span
      className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold ${className}`}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Response readers.
//
// The API answers with JSON, but a proxy, a redirect to the login page, or a
// crash can put something else on the wire. These narrow an `unknown` body
// without asserting, so a malformed response produces a sentence the participant
// can act on rather than a thrown TypeError inside a click handler.
// ---------------------------------------------------------------------------

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function readSubmission(body: unknown): SubmissionResponseData | null {
  if (!body || typeof body !== 'object' || !('submission' in body)) return null;
  const value = (body as { submission?: unknown }).submission;
  if (!value || typeof value !== 'object') return null;
  return value as SubmissionResponseData;
}
