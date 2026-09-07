import { getEvaluatorActivityLogsAction } from '@/lib/actions/evaluator-actions';
import { EvaluatorActivityClient } from '@/components/evaluator/activity-client';

export default async function EvaluatorActivityPage() {
  const result = await getEvaluatorActivityLogsAction({ page: 1, limit: 25 });

  const logs = result.success && result.data ? result.data.logs : [];
  const totalCount = result.success && result.data ? result.data.totalCount : 0;
  const totalPages = result.success && result.data ? result.data.totalPages : 1;

  return (
    <EvaluatorActivityClient initialLogs={logs} totalCount={totalCount} totalPages={totalPages} />
  );
}
