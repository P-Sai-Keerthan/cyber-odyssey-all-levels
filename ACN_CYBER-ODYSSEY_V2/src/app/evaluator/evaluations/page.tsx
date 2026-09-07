import { getEvaluatorSubmissionsAction } from '@/lib/actions/evaluator-actions';
import { EvaluatorEvaluationsClient } from '@/components/evaluator/evaluations-client';

export default async function EvaluatorEvaluationsListPage() {
  const result = await getEvaluatorSubmissionsAction({
    page: 1,
    limit: 20,
    status: 'EVALUATED',
  });

  const submissions = result.success && result.data ? result.data.submissions : [];
  const totalCount = result.success && result.data ? result.data.totalCount : 0;
  const totalPages = result.success && result.data ? result.data.totalPages : 1;

  return (
    <EvaluatorEvaluationsClient
      initialSubmissions={submissions}
      totalCount={totalCount}
      totalPages={totalPages}
    />
  );
}
