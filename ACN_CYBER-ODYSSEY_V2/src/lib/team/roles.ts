/**
 * Squad roster roles, and the one place that decides who the HEAD is.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `TeamMember.role` carries two values for the same thing. `createTeamAction`
 * writes `'HEAD'`; older code and the local-testing seed wrote `'CREATOR'`,
 * which is also the name of a completely different concept in this portal — the
 * CREATOR *account* role, which is event staff and has nothing to do with a
 * squad's captain.
 *
 * Six read sites each decided for themselves how to resolve the head, and they
 * did not agree. `creator-actions.ts` accepted either value; the participant
 * dashboard accepted either; `admin-actions.ts` accepted only `'HEAD'`. So on a
 * database seeded with the legacy value, the Admin → Teams page showed every
 * squad with NO head at all, while the same squad displayed one correctly on the
 * Creator console two clicks away.
 *
 * Written once, here. A seventh read site cannot invent a seventh answer.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LEGACY VALUE IS STILL ACCEPTED
 * ---------------------------------------------------------------------------
 * A backfill fixes the rows that exist today, and the seed now writes `'HEAD'`.
 * But a database restored from an older backup mid-event would bring the legacy
 * value back, and the failure mode — a squad with no visible captain on the
 * operations console — is one nobody would notice until they needed to contact
 * that captain. Accepting both costs one comparison.
 */

export const TEAM_ROLE = {
  /** The squad captain. One per squad, always roster slot 1. */
  HEAD: 'HEAD',
  /** Any other member of the squad. */
  MEMBER: 'MEMBER',
} as const;

export type TeamRole = (typeof TEAM_ROLE)[keyof typeof TEAM_ROLE];

/**
 * The value older rows use for the squad captain.
 *
 * Deliberately NOT exported as something to write. Nothing should create it; it
 * exists so reads can recognise it.
 */
const LEGACY_HEAD_ROLE = 'CREATOR';

/** Is this roster role the squad captain? Accepts the legacy spelling. */
export function isTeamHeadRole(role: string | null | undefined): boolean {
  return role === TEAM_ROLE.HEAD || role === LEGACY_HEAD_ROLE;
}

/**
 * Finds the squad captain on a roster.
 *
 * Falls back to the first member so an operations console never renders a blank
 * where a name belongs. A squad always has a captain in practice — slot 1 is
 * created with the squad — so the fallback covers a corrupted roster, not a
 * normal one.
 */
export function findTeamHead<T extends { role: string }>(members: readonly T[]): T | undefined {
  return members.find((m) => isTeamHeadRole(m.role)) ?? members[0];
}

/** The label to SHOW for a roster role. Never "CREATOR" — that is a staff role. */
export function teamRoleLabel(role: string | null | undefined): 'HEAD' | 'MEMBER' {
  return isTeamHeadRole(role) ? 'HEAD' : 'MEMBER';
}
