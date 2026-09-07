import { getEvaluatorTeamsAction } from '@/lib/actions/evaluator-actions';
import { EvaluatorTeamsClient } from '@/components/evaluator/teams-client';

export default async function EvaluatorTeamsPage() {
  const result = await getEvaluatorTeamsAction({ page: 1, limit: 20 });

  const teams = result.success && result.data ? result.data.teams : [];
  const totalCount = result.success && result.data ? result.data.totalCount : 0;
  const totalPages = result.success && result.data ? result.data.totalPages : 1;

  return (
    <EvaluatorTeamsClient initialTeams={teams} totalCount={totalCount} totalPages={totalPages} />
  );
}
