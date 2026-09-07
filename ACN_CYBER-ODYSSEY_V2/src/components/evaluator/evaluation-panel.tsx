'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  saveEvaluationAction,
  startEvaluationAction,
  type EvaluatorSubmissionDetail,
} from '@/lib/actions/evaluator-actions';
import { formatDateTime } from '@/lib/utils/date-formatter';

interface EvaluationPanelProps {
  submission: EvaluatorSubmissionDetail;
}

export function EvaluationPanel({ submission }: EvaluationPanelProps) {
  const router = useRouter();

  /**
   * The level's configured maximum, resolved on the SERVER from
   * `LevelState.maxScore` (see lib/evaluation/level-max-score.ts). There is no
   * client-side fallback: this used to read `|| 1000`, which meant a level
   * configured at 200 rendered "/ 1000 PTS" the moment the server sent 0, and an
   * evaluator would have had no way to tell. If the server cannot resolve a
   * maximum the panel says so and refuses to score, which is the honest failure.
   */
  const maxPossibleScore = submission.maxPossibleScore;
  const hasConfiguredMax = Number.isInteger(maxPossibleScore) && maxPossibleScore > 0;

  const [score, setScore] = React.useState<number>(() => {
    if (typeof submission.evaluation?.score === 'number') {
      return submission.evaluation.score;
    }
    return 0;
  });

  const [notes, setNotes] = React.useState(submission.evaluation?.notes || '');
  const [feedback, setFeedback] = React.useState(submission.evaluation?.feedback || '');
  const [version, setVersion] = React.useState(submission.evaluation?.version || 1);
  const [evalStatus, setEvalStatus] = React.useState<string>(
    submission.evaluation?.status || 'PENDING',
  );

  const [isSaving, setIsSaving] = React.useState(false);
  const [feedbackMessage, setFeedbackMessage] = React.useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const isScoreValid = React.useMemo(() => {
    return (
      hasConfiguredMax &&
      typeof score === 'number' &&
      !isNaN(score) &&
      Number.isInteger(score) &&
      score >= 0 &&
      score <= maxPossibleScore
    );
  }, [score, maxPossibleScore, hasConfiguredMax]);

  const handleScoreChange = (val: string) => {
    if (val === '') {
      setScore(0);
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setScore(parsed);
    }
  };

  const handleStartReview = async () => {
    setIsSaving(true);
    setFeedbackMessage(null);
    const res = await startEvaluationAction(submission.id);
    if (res.success && res.data) {
      setEvalStatus('IN_REVIEW');
      setVersion(res.data.version);
      setFeedbackMessage({
        type: 'success',
        text: 'Evaluation started (Status: IN_REVIEW).',
      });
      router.refresh();
    } else {
      setFeedbackMessage({ type: 'error', text: res.error || 'Failed to start evaluation.' });
    }
    setIsSaving(false);
  };

  const handleSaveEvaluation = async (targetStatus: 'IN_REVIEW' | 'EVALUATED' | 'RETURNED') => {
    if (targetStatus === 'EVALUATED' && !isScoreValid) {
      setFeedbackMessage({
        type: 'error',
        text: `Score must be an integer between 0 and ${maxPossibleScore} PTS.`,
      });
      return;
    }

    setIsSaving(true);
    setFeedbackMessage(null);

    const res = await saveEvaluationAction({
      submissionId: submission.id,
      score,
      notes,
      feedback,
      status: targetStatus,
      version,
    });

    if (res.success && res.data) {
      setEvalStatus(res.data.status);
      setVersion(res.data.version);
      const msg =
        targetStatus === 'EVALUATED'
          ? `Evaluation submitted for Admin Approval (${res.data.score}/${res.data.maxScore ?? maxPossibleScore} PTS). It will not count on the leaderboard until approved.`
          : targetStatus === 'RETURNED'
            ? 'Deliverables returned for squad revision.'
            : 'Evaluation score saved as draft.';
      setFeedbackMessage({ type: 'success', text: msg });
      router.refresh();
    } else {
      setFeedbackMessage({
        type: 'error',
        text: res.error || 'Failed to save evaluation.',
      });
    }

    setIsSaving(false);
  };

  return (
    <div className="space-y-8 font-mono">
      {/* Top Header & Breadcrumb */}
      <div className="border-border/80 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
            <Link href="/evaluator/submissions" className="hover:text-cyan-300">
              &larr; SUBMISSIONS
            </Link>
            <span>/</span>
            <span className="text-cyan-400">EVALUATION DESK</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
            EVALUATION: {submission.teamName.toUpperCase()}
          </h1>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>LEVEL {submission.level} DELIVERABLES</span>
            <span>&bull;</span>
            <span>SUBMITTED: {formatDateTime(submission.submittedAt)}</span>
            <span>&bull;</span>
            <span className="rounded border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 font-bold text-cyan-300">
              CURRENT SUBMISSION · ATTEMPT {submission.attemptCount}
            </span>
          </div>

          {submission.attempts.length > 0 && (
            <details className="text-muted-foreground mt-2 text-xs">
              <summary className="cursor-pointer hover:text-cyan-300">
                {submission.attempts.length} earlier attempt
                {submission.attempts.length === 1 ? '' : 's'} (history — not judged)
              </summary>
              <ul className="border-border/60 mt-2 space-y-1 border-l pl-3">
                {submission.attempts.map((attempt) => (
                  <li key={attempt.attemptNumber} className="text-[11px]">
                    <span className="text-foreground/80">ATTEMPT {attempt.attemptNumber}</span>{' '}
                    &bull; {formatDateTime(attempt.submittedAt)}
                    {attempt.fileNames.length > 0 && (
                      <span className="break-all"> &bull; {attempt.fileNames.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Evaluation Status Badge */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-muted-foreground text-[10px] uppercase">CURRENT STATUS</div>
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                evalStatus === 'EVALUATED'
                  ? 'border border-emerald-500/50 bg-emerald-950/60 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                  : evalStatus === 'IN_REVIEW'
                    ? 'border border-blue-500/50 bg-blue-950/60 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                    : evalStatus === 'RETURNED'
                      ? 'border border-rose-500/50 bg-rose-950/60 text-rose-300'
                      : 'border border-amber-500/50 bg-amber-950/60 text-amber-300'
              }`}
            >
              {evalStatus === 'EVALUATED' ? 'PENDING APPROVAL' : evalStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      {feedbackMessage && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 text-xs font-bold ${
            feedbackMessage.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
          }`}
        >
          <span>{feedbackMessage.text}</span>
          {feedbackMessage.type === 'error' && (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="ml-4 shrink-0 rounded-lg border border-rose-400 bg-rose-900/60 px-3 py-1 font-mono text-[10px] text-white hover:bg-rose-800"
            >
              RELOAD
            </button>
          )}
        </div>
      )}

      {/* Main Grid: Left = Submission Evidence & Team, Right = Simple Final Score */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: Evidence & Team Information (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          {/* Squad Details Card */}
          <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 backdrop-blur-xl">
            <div className="border-border/60 flex items-center justify-between border-b pb-3">
              <span className="text-xs font-bold text-cyan-400 uppercase">SQUAD INFORMATION</span>
              <span className="text-muted-foreground text-[10px]">ID: {submission.team.id}</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Squad Name:</span>
                <span className="font-bold text-white">{submission.teamName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deliverable Level:</span>
                <span className="font-bold text-cyan-300">LEVEL {submission.level}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Team Head:</span>
                <span className="font-bold text-cyan-300">{submission.teamHead}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Submitted By:</span>
                <span className="font-bold text-white">
                  {submission.submitterName} ({submission.submitterRole})
                </span>
              </div>
            </div>

            {/* Squad Members */}
            <div className="pt-2">
              <div className="text-muted-foreground mb-2 text-[10px] font-bold uppercase">
                VERIFIED SQUAD ROSTER
              </div>
              <div className="divide-border/60 border-border/80 bg-background/60 divide-y rounded-xl border">
                {submission.team.roster.map((m, idx) => (
                  <div key={m.userId} className="flex items-center justify-between p-2.5 text-xs">
                    <span className="font-bold text-white">
                      {m.displayName ? `${m.displayName} (@${m.username})` : `@${m.username}`}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {m.role === 'Team Head' || idx === 0 ? 'TEAM HEAD' : `MEMBER ${idx}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Attached Files & Deliverables Inspection */}
          <div className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-5 backdrop-blur-xl">
            <div className="border-border/60 flex items-center justify-between border-b pb-3">
              <span className="text-xs font-bold text-cyan-400 uppercase">
                ATTACHED DELIVERABLES ({submission.files.length})
              </span>
              <span className="text-muted-foreground text-[10px]">VERIFIED STREAM</span>
            </div>

            {submission.files.length === 0 ? (
              <div className="border-border/60 bg-background/40 text-muted-foreground rounded-xl border p-4 text-center text-xs">
                No deliverable files uploaded.
              </div>
            ) : (
              <div className="space-y-2.5">
                {submission.files.map((file) => (
                  <div
                    key={file.id}
                    className="border-border/80 bg-background/80 flex items-center justify-between rounded-xl border p-3 text-xs"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className="text-cyan-400">
                        <svg
                          className="size-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </span>
                      <div className="flex flex-col truncate">
                        <span className="truncate font-bold text-white" title={file.originalName}>
                          {file.originalName}
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          {(file.fileSize / 1024).toFixed(1)} KB &bull; {file.mimeType}
                        </span>
                      </div>
                    </div>

                    <a
                      href={`/api/evaluator/files/${file.id}`}
                      download
                      className="shrink-0 rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-3 py-1.5 font-mono text-[11px] font-bold text-cyan-300 hover:bg-cyan-900/60"
                    >
                      DOWNLOAD
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Simple Final Score & Evaluation Controls (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          <div className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 backdrop-blur-xl">
            {/* Header */}
            <div className="border-border/60 border-b pb-4">
              <span className="text-xs font-bold tracking-widest text-cyan-400 uppercase">
                EVALUATION
              </span>
              <h2 className="text-2xl font-black tracking-wide text-white">
                LEVEL {submission.level}
              </h2>
            </div>

            {/*
              Rubric/configuration disagreement. The server suppresses a rubric
              that does not sum to the level's configured maximum rather than
              scoring against a total nobody set; this is where the evaluator is
              told that happened.
            */}
            {submission.criteriaMismatch && (
              <div
                data-testid="criteria-mismatch-warning"
                className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 text-xs font-bold text-amber-300"
              >
                {submission.criteriaMismatch}
              </div>
            )}

            {!hasConfiguredMax && (
              <div
                data-testid="no-configured-max"
                className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-xs font-bold text-rose-300"
              >
                Level {submission.level} has no configured maximum score, so this deliverable cannot
                be scored yet. An Admin sets it at Admin &rarr; Levels.
              </div>
            )}

            {/* Final Score Card */}
            <div className="bg-background/80 space-y-4 rounded-xl border border-cyan-500/30 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wider text-cyan-300 uppercase">
                  FINAL SCORE
                </span>
                <span className="text-muted-foreground text-[11px]">
                  MAXIMUM: {hasConfiguredMax ? `${maxPossibleScore} PTS` : 'NOT CONFIGURED'}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative">
                  <input
                    id="final-score-input"
                    type="number"
                    min={0}
                    max={maxPossibleScore}
                    step={1}
                    value={score}
                    onChange={(e) => handleScoreChange(e.target.value)}
                    disabled={isSaving || !hasConfiguredMax}
                    className="bg-card/90 w-36 rounded-xl border-2 border-cyan-500 px-4 py-3 text-center text-3xl font-black text-white shadow-[0_0_15px_rgba(34,211,238,0.25)] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/40 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div className="text-xl font-bold text-cyan-400">
                  / {hasConfiguredMax ? `${maxPossibleScore} PTS` : '— PTS'}
                </div>
              </div>

              {hasConfiguredMax && !isScoreValid && (
                <p className="text-xs font-bold text-rose-400">
                  Score must be a whole integer between 0 and {maxPossibleScore} PTS.
                </p>
              )}
            </div>

            {/* Evaluator Internal Notes */}
            <div className="space-y-2">
              <label
                htmlFor="eval-internal-notes"
                className="text-muted-foreground text-xs font-bold tracking-wider uppercase"
              >
                INTERNAL JURY NOTES (CONFIDENTIAL)
              </label>
              <textarea
                id="eval-internal-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSaving}
                placeholder="Private evaluator notes, evidence verification remarks, or investigation observations..."
                className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border p-3 text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Final Squad Remarks / Feedback */}
            <div className="space-y-2">
              <label
                htmlFor="eval-squad-feedback"
                className="text-muted-foreground text-xs font-bold tracking-wider uppercase"
              >
                SQUAD FEEDBACK / JURY REMARKS (VISIBLE TO SQUAD)
              </label>
              <textarea
                id="eval-squad-feedback"
                rows={3}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={isSaving}
                placeholder="Constructive feedback or debrief remarks for the squad upon approval..."
                className="border-border/80 bg-background/80 text-foreground placeholder:text-muted-foreground/60 w-full rounded-xl border p-3 text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Action Buttons Hub */}
            <div className="border-border/80 space-y-4 border-t pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {evalStatus === 'PENDING' && (
                  <button
                    type="button"
                    onClick={handleStartReview}
                    disabled={isSaving}
                    className="rounded-xl border border-blue-500/50 bg-blue-950/40 px-5 py-2.5 text-xs font-bold text-blue-300 hover:bg-blue-900/60 disabled:opacity-50"
                  >
                    START REVIEW
                  </button>
                )}

                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSaveEvaluation('IN_REVIEW')}
                    disabled={isSaving}
                    className="border-border bg-card text-muted-foreground hover:bg-card/80 rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors hover:text-white disabled:opacity-50"
                  >
                    SAVE SCORE
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveEvaluation('RETURNED')}
                    disabled={isSaving}
                    className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-2.5 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-900/60 disabled:opacity-50"
                  >
                    RETURN FOR REVISION
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveEvaluation('EVALUATED')}
                    disabled={isSaving || !isScoreValid}
                    className="flex items-center gap-2 rounded-xl border border-cyan-400 bg-cyan-500 px-6 py-2.5 text-xs font-black text-black shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all hover:bg-cyan-400 disabled:opacity-50"
                  >
                    <span>SUBMIT EVALUATION</span>
                    <span>({score} PTS)</span>
                  </button>
                </div>
              </div>

              <div className="text-muted-foreground flex items-center justify-between pt-1 text-[10px]">
                <span>Lock Version: v{version}</span>
                <span>
                  Max score is database-configured • Requires Admin Approval before official
                  leaderboard publication
                </span>
              </div>
            </div>
          </div>

          {/*
            SCORE ADJUSTMENTS LIVE ON THEIR OWN PAGE.

            The "Additional Points Request" form used to be rendered here, on the
            evaluation screen. That put a discretionary, Admin-gated allocation
            control inside the workspace for scoring ONE deliverable, where it
            read as part of the evaluation — and it duplicated the dedicated
            /evaluator/score-adjustments page, so the same request could be filed
            from two places with two different sets of defaults.

            The backend is untouched: `requestScoreAdjustmentAction`, the
            ScoreAdjustment model and Admin approval all work exactly as before.
            Only the entry point moved. This is a LINK, not a second form.
          */}
          <div className="border-border/80 bg-card/60 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 backdrop-blur-xl">
            <div>
              <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">
                DISCRETIONARY ALLOCATION // ADMIN SUPERVISED
              </span>
              <p className="text-muted-foreground mt-1 text-xs">
                Bonus or adjustment points for this squad are requested from the Score Adjustments
                desk, and require Admin approval before they reach the leaderboard.
              </p>
            </div>
            <Link
              href="/evaluator/score-adjustments"
              className="shrink-0 rounded-xl border border-amber-500/50 bg-amber-950/40 px-4 py-2.5 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-900/60"
            >
              OPEN SCORE ADJUSTMENTS &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
