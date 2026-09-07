import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getEvaluationQueueAction } from '@/lib/actions/evaluation-approval-actions';
import { EvaluationsHubClient } from '@/components/admin/evaluations-hub-client';

export const metadata: Metadata = {
  title: 'Evaluation Approval & Criteria | Admin Control',
  description:
    'Review evaluator scoring, approve evaluations for the leaderboard, and configure dynamic scoring criteria.',
};

/**
 * Admin evaluation approval and criteria configuration console.
 */
export default async function AdminEvaluationsPage() {
  await requireAdmin();

  const res = await getEvaluationQueueAction();

  if (!res.success || !res.data) {
    return (
      <div className="border-border/80 bg-card/60 flex flex-col items-center justify-center rounded-2xl border p-12 text-center backdrop-blur-xl">
        <span className="font-mono text-sm font-bold text-rose-400">
          EVALUATION QUEUE UNAVAILABLE
        </span>
        <p className="text-muted-foreground mt-2 max-w-md font-sans text-xs">
          {res.error ?? 'The evaluation queue could not be loaded. Please refresh the page.'}
        </p>
      </div>
    );
  }

  return (
    <EvaluationsHubClient initialEvaluations={res.data.evaluations} totalCount={res.data.total} />
  );
}
