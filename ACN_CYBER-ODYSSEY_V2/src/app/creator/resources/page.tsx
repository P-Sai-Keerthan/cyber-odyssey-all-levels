import type { Metadata } from 'next';
import { requireCreator } from '@/lib/auth/guards';
import { getCreatorLevelResourcesAction } from '@/lib/actions/creator-resource-actions';
import { LevelResourcesClient } from '@/components/creator/level-resources-client';

export const metadata: Metadata = {
  title: 'Level 2 Resources | Creator Control Center',
  description:
    'Manage downloadable case evidence packages and sample investigation reports for Level 2.',
};

export default async function CreatorLevelResourcesPage() {
  await requireCreator();

  const res = await getCreatorLevelResourcesAction(2);
  const resources = res.success && res.data ? res.data.resources : [];

  return <LevelResourcesClient initialResources={resources} levelNumber={2} />;
}
