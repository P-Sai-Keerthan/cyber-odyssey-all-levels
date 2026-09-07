import type { Metadata } from 'next';
import { requireEvaluator } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { getScoreAdjustments } from '@/lib/score-adjustments/service';
import { EvaluatorScoreAdjustmentsClient } from '@/components/evaluator/evaluator-score-adjustments-client';

export const metadata: Metadata = {
  title: 'Score Adjustments | Evaluator Portal',
  description:
    'Recommend discretionary score adjustments and bonus points for squads across Level 1, 2, and 3. Subject to Admin review.',
};

/**
 * Evaluator Score Adjustments Page.
 * Server Component protected by requireEvaluator() guard.
 * Provides target squad selection and list of pending/approved/rejected score adjustment requests.
 */
export default async function EvaluatorScoreAdjustmentsPage() {
  await requireEvaluator();

  // Query only safe team information (no passwords, hashes, or join codes)
  const [teams, adjustmentsData] = await Promise.all([
    prisma.team.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        code: true,
      },
      orderBy: { name: 'asc' },
    }),
    getScoreAdjustments({ status: 'ALL' }),
  ]);

  return (
    <EvaluatorScoreAdjustmentsClient
      teams={teams}
      initialAdjustments={adjustmentsData.adjustments}
    />
  );
}
