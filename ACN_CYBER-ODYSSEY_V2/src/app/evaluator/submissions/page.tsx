import { getEvaluatorSubmissionsAction } from '@/lib/actions/evaluator-actions';
import { EvaluatorSubmissionsClient } from '@/components/evaluator/submissions-client';

export default async function EvaluatorSubmissionsPage() {
  const result = await getEvaluatorSubmissionsAction({ page: 1, limit: 20 });

  const submissions = result.success && result.data ? result.data.submissions : [];
  const totalCount = result.success && result.data ? result.data.totalCount : 0;
  const totalPages = result.success && result.data ? result.data.totalPages : 1;
  const summaryStats = result.success && result.data ? result.data.summaryStats : undefined;

  return (
    <EvaluatorSubmissionsClient
      initialSubmissions={submissions}
      totalCount={totalCount}
      totalPages={totalPages}
      initialSummaryStats={summaryStats}
    />
  );
}
