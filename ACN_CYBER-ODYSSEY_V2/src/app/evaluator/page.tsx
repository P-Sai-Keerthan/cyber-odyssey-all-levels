import { getEvaluatorOverviewStatsAction } from '@/lib/actions/evaluator-actions';
import { EvaluatorDashboardClient } from '@/components/evaluator/dashboard-client';

export default async function EvaluatorDashboardPage() {
  const result = await getEvaluatorOverviewStatsAction();

  if (!result.success || !result.data) {
    return (
      <div className="border-border/80 bg-card/60 flex flex-col items-center justify-center rounded-2xl border p-12 text-center backdrop-blur-xl">
        <span className="font-mono text-sm font-bold text-rose-400">
          FAILED TO LOAD EVALUATOR METRICS
        </span>
        <p className="text-muted-foreground mt-2 text-xs">
          {result.error || 'Unknown error occurred.'}
        </p>
      </div>
    );
  }

  return <EvaluatorDashboardClient initialStats={result.data} />;
}
