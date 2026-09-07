import type { Metadata } from 'next';
import { requireCreator } from '@/lib/auth/guards';
import { getCreatorLevelResourcesAction } from '@/lib/actions/creator-resource-actions';
import { LevelResourcesClient } from '@/components/creator/level-resources-client';
import { Level3TargetConfigClient } from '@/components/creator/level3-target-config-client';
import { getLevel3Config } from '@/lib/level3/target-config';
import { getLevel3EvaluatedPoints } from '@/lib/level3/score-summary';

export const metadata: Metadata = {
  title: 'Level 3 Configuration | Creator Control Center',
  description:
    'Configure the Level 3 target address, track release, and the downloadable sample investigation report.',
};

/**
 * Creator — Level 3 configuration.
 *
 * The target address and the sample report are the two things a Creator sets for
 * Level 3, so they sit on ONE page rather than in two consoles. Both are
 * database-backed: nothing on the participant page carries a literal address or
 * a literal filename.
 */
export default async function CreatorLevel3ResourcesPage() {
  await requireCreator();

  const [res, config, evaluated] = await Promise.all([
    getCreatorLevelResourcesAction(3),
    getLevel3Config(),
    getLevel3EvaluatedPoints(),
  ]);

  const resources = res.success && res.data ? res.data.resources : [];

  return (
    <div className="space-y-8">
      <Level3TargetConfigClient
        initialConfig={config}
        reportPoints={evaluated.reportPoints}
        responsePoints={evaluated.responsePoints}
      />
      <LevelResourcesClient
        initialResources={resources}
        levelNumber={3}
        levelName="ORION Network"
        levelDescription="Upload, replace, and manage downloadable challenge packages and the sample investigation report participants see in Level 3 Final Submission."
      />
    </div>
  );
}
