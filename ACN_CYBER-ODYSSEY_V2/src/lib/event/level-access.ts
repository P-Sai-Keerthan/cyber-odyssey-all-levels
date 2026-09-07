import { getLevelState, type AuthoritativeLevelState } from './level-state';

export interface EventLevel {
  number: number;
  level: string;
  name: string;
  codename: string;
  route: string;
  status: 'ACTIVE' | 'LOCKED' | 'UPCOMING' | 'COMPLETED' | 'PAUSED';
  scheduledTime: string;
  duration: string;
  points: string;
  description: string;
  active: boolean;
}

export const EVENT_LEVELS: EventLevel[] = [
  {
    number: 1,
    level: 'LEVEL 1',
    name: 'Level 1 — The Initial Trace',
    codename: 'THE INITIAL TRACE',
    route: '/event/level-1',
    status: 'ACTIVE',
    scheduledTime: '09:30 AM',
    duration: '01:30:00',
    points: '100 PTS',
    description:
      'Analyze compromised edge gateways, inspect authentication logs, and extract initial adversary intrusion signatures.',
    active: true,
  },
  {
    number: 2,
    level: 'LEVEL 2',
    name: "Level 2 — The Boar's Mark",
    codename: "THE BOAR'S MARK",
    route: '/event/level-2',
    status: 'ACTIVE',
    scheduledTime: '11:30 AM',
    duration: '02:00:00',
    // SOURCE OF TRUTH for the Level 2 point label. The /event card and the Level 2
    // workspace both read it from here rather than carrying their own copy, which
    // is how the workspace came to show 800 while the card said something else.
    points: '1000 PTS',
    description:
      'Physical and digital forensic investigation. Trace adversary movement through internal VLAN subnets, inspect memory artifacts, and reconstruct the attack chain.',
    active: true,
  },
  {
    number: 3,
    level: 'LEVEL 3',
    name: 'Level 3 — The Twelve Axes',
    codename: 'THE TWELVE AXES',
    route: '/event/level-3',
    status: 'LOCKED',
    scheduledTime: '01:30 PM',
    duration: '02:30:00',
    // FALLBACK ONLY. Level 3's real ceiling is configured — Track 1/Track 2 in
    // Level3Config plus the keyed Report and Response criteria — and moves when
    // the Creator releases Track 2. Both the /event card and the Level 3 page
    // read `getLevel3ScoreSummary()`; this literal is what a caller with no
    // database access falls back to, and must not be treated as authoritative.
    points: '3,900 PTS',
    description:
      'Reverse engineering advanced adversary malware implants, neutralizing exfiltration channels, and final evidence submission.',
    active: false,
  },
];

export function getEventLevels(): EventLevel[] {
  return EVENT_LEVELS;
}

export function getLevelConfig(levelNumber: number): EventLevel | undefined {
  return EVENT_LEVELS.find((l) => l.number === levelNumber);
}

/**
 * Synchronous level access verification using fallback static config.
 */
export function checkLevelAccess(
  levelNumber: number,
  hasTeamMembership: boolean,
): { allowed: boolean; reason?: string; config?: EventLevel } {
  if (!hasTeamMembership) {
    return {
      allowed: false,
      reason: 'You must belong to an active squad to access competition levels.',
    };
  }

  const config = getLevelConfig(levelNumber);
  if (!config) {
    return { allowed: false, reason: 'Invalid level requested.' };
  }

  if (config.status === 'LOCKED' || config.status === 'UPCOMING') {
    return {
      allowed: false,
      reason: `${config.level} (${config.codename}) is currently locked and awaiting marshal activation.`,
      config,
    };
  }

  return { allowed: true, config };
}

/**
 * Server-authoritative level access verification backed by Prisma LevelState.
 */
export async function checkAuthoritativeLevelAccess(
  levelNumber: number,
  hasTeamMembership: boolean,
): Promise<{
  allowed: boolean;
  reason?: string;
  state?: AuthoritativeLevelState;
  isPaused?: boolean;
  isCompleted?: boolean;
}> {
  if (!hasTeamMembership) {
    return {
      allowed: false,
      reason: 'You must belong to an active squad to access competition levels.',
    };
  }

  const state = await getLevelState(levelNumber);
  if (!state) {
    return { allowed: false, reason: 'Invalid level requested.' };
  }

  if (state.status === 'LOCKED' || state.status === 'READY') {
    return {
      allowed: false,
      reason: `${state.name} (${state.codename}) is currently locked and awaiting marshal activation.`,
      state,
    };
  }

  if (state.status === 'PAUSED') {
    return {
      allowed: false,
      isPaused: true,
      reason: 'LEVEL PAUSED // WAIT FOR FURTHER INSTRUCTIONS',
      state,
    };
  }

  if (state.status === 'COMPLETED' || state.isExpired) {
    return {
      allowed: false,
      isCompleted: true,
      reason: `${state.name} (${state.codename}) has completed. New submissions are closed.`,
      state,
    };
  }

  return { allowed: true, state };
}
