'use client';

import * as React from 'react';
import {
  EvaluationApprovalClient,
  type EvaluationApprovalClientProps,
} from './evaluation-approval-client';
import { EvaluationCriteriaManager } from './evaluation-criteria-manager';

export function EvaluationsHubClient(props: EvaluationApprovalClientProps) {
  const [hubMode, setHubMode] = React.useState<'APPROVAL_QUEUE' | 'CRITERIA_RUBRIC'>(
    'APPROVAL_QUEUE',
  );

  return (
    <div className="space-y-6">
      {/* Top mode switcher */}
      <div className="border-border/80 flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setHubMode('APPROVAL_QUEUE')}
            className={`rounded-xl px-4 py-2 font-bold transition-all ${
              hubMode === 'APPROVAL_QUEUE'
                ? 'border border-cyan-500/50 bg-cyan-950/60 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                : 'border-border/60 bg-card/40 text-muted-foreground border hover:text-white'
            }`}
          >
            APPROVAL QUEUE
          </button>
          <button
            type="button"
            onClick={() => setHubMode('CRITERIA_RUBRIC')}
            className={`rounded-xl px-4 py-2 font-bold transition-all ${
              hubMode === 'CRITERIA_RUBRIC'
                ? 'border border-cyan-500/50 bg-cyan-950/60 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                : 'border-border/60 bg-card/40 text-muted-foreground border hover:text-white'
            }`}
          >
            CRITERIA & RUBRIC CONFIGURATION
          </button>
        </div>

        <div className="text-muted-foreground hidden font-mono text-[11px] sm:block">
          DYNAMIC EVALUATION ENGINE · PER-LEVEL RUBRIC
        </div>
      </div>

      {hubMode === 'APPROVAL_QUEUE' ? (
        <EvaluationApprovalClient {...props} />
      ) : (
        <EvaluationCriteriaManager />
      )}
    </div>
  );
}
