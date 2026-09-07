import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getAdminScoreAdjustmentsAction } from '@/lib/actions/score-adjustment-actions';
import { ScoreAdjustmentsClient } from '@/components/admin/score-adjustments-client';

export const metadata: Metadata = {
  title: 'Score Adjustments | Admin Control',
  description:
    'Review, approve, and reject discretionary score adjustments requested by evaluators for Level 1, 2, and 3.',
};

/**
 * Admin Score Adjustments Console.
 * Allows administrators to oversee discretionary point requests, ensuring that
 * all extra points awarded are legitimate, justified, and auditable.
 */
export default async function AdminScoreAdjustmentsPage() {
  await requireAdmin();

  const res = await getAdminScoreAdjustmentsAction({ status: 'ALL' });

  if (!res.success || !res.data) {
    return (
      <div className="border-border/80 bg-card/60 flex flex-col items-center justify-center rounded-2xl border p-12 text-center backdrop-blur-xl">
        <span className="font-mono text-sm font-bold text-rose-400">
          SCORE ADJUSTMENTS QUEUE UNAVAILABLE
        </span>
        <p className="text-muted-foreground mt-2 max-w-md font-sans text-xs">
          {res.error ?? 'The score adjustments queue could not be loaded. Please refresh the page.'}
        </p>
      </div>
    );
  }

  return (
    <ScoreAdjustmentsClient initialAdjustments={res.data.adjustments} totalCount={res.data.total} />
  );
}
