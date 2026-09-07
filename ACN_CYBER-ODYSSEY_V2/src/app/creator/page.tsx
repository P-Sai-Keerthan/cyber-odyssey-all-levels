import type { Metadata } from 'next';
import {
  getCreatorOverviewStatsAction,
  getPendingStaffAction,
} from '@/lib/actions/creator-actions';
import { OverviewClient } from '@/components/creator/overview-client';

export const metadata: Metadata = {
  title: 'Control Center Overview',
  description: 'Cyber Odyssey operational overview and live event statistics.',
};

export default async function CreatorOverviewPage() {
  const [statsResult, pendingResult] = await Promise.all([
    getCreatorOverviewStatsAction(),
    getPendingStaffAction(),
  ]);

  const stats = statsResult.data || {
    totalParticipants: 0,
    totalEvaluators: 0,
    totalAdmins: 0,
    totalTeams: 0,
    pendingStaffApprovals: 0,
    activeAccounts: 0,
    blockedAccounts: 0,
    activeTeams: 0,
    blockedTeams: 0,
    activeSessions: 0,
    portalStatus: { isOnline: true, updatedAt: new Date(), updatedBy: null },
  };

  const pending = pendingResult.data || [];

  return <OverviewClient initialStats={stats} initialPending={pending} />;
}
