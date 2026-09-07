import type { Metadata } from 'next';
import { requireEvaluator } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { getPortalStatus } from '@/lib/event/portal-settings';
import { EvaluatorShell } from '@/components/evaluator/evaluator-shell';

export const metadata: Metadata = {
  title: {
    template: '%s | Evaluator Portal | ACN Cyber Odyssey',
    default: 'Evaluator Portal | ACN Cyber Odyssey',
  },
  description: 'Cyber Odyssey evaluation console and forensic evidence review desk.',
};

export default async function EvaluatorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireEvaluator();

  const [pendingEvaluationsCount, portalStatus] = await Promise.all([
    prisma.submission.count({
      where: {
        OR: [{ evaluation: null }, { evaluation: { status: { in: ['PENDING', 'IN_REVIEW'] } } }],
      },
    }),
    getPortalStatus(),
  ]);

  return (
    <EvaluatorShell
      username={user.username}
      pendingEvaluationsCount={pendingEvaluationsCount}
      isPortalOnline={portalStatus.isOnline}
    >
      {children}
    </EvaluatorShell>
  );
}
