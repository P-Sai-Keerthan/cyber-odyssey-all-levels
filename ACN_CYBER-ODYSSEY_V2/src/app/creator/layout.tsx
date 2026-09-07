import type { Metadata } from 'next';
import { requireCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { getPortalStatus } from '@/lib/event/portal-settings';
import { CreatorShell } from '@/components/creator/creator-shell';

export const metadata: Metadata = {
  title: {
    template: '%s | Creator Control Center | ACN Cyber Odyssey',
    default: 'Creator Control Center | ACN Cyber Odyssey',
  },
  description: 'Cyber Odyssey highest-level event management and operational command desk.',
};

export default async function CreatorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCreator();

  const [pendingApprovalsCount, portalStatus] = await Promise.all([
    prisma.user.count({
      where: {
        status: 'PENDING_APPROVAL',
        role: { in: ['EVALUATOR', 'ADMIN'] },
      },
    }),
    getPortalStatus(),
  ]);

  return (
    <CreatorShell
      username={user.username}
      pendingApprovalsCount={pendingApprovalsCount}
      isPortalOnline={portalStatus.isOnline}
    >
      {children}
    </CreatorShell>
  );
}
