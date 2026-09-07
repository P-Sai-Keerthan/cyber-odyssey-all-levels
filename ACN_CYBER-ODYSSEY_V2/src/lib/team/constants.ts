/**
 * Canonical squad-composition rules for ACN Cyber Odyssey.
 *
 * MAX_TEAM_SIZE is enforced at three layers, deliberately:
 *   1. DATABASE  — TeamMember.slot with @@unique([teamId, slot]); a fourth
 *                  concurrent joiner cannot acquire a slot. See prisma/schema.prisma.
 *   2. SERVER    — joinTeamAction allocates the lowest free slot in 1..MAX_TEAM_SIZE
 *                  inside a transaction and retries on unique-constraint collision.
 *   3. UI        — remaining-slot messaging on /team and /team/onboarding.
 *
 * Layer 3 is presentation only. Layers 1 and 2 are the actual guarantee.
 */
export const MAX_TEAM_SIZE = 3;

/** Every valid roster slot, in allocation order. */
export const TEAM_SLOTS: readonly number[] = Object.freeze(
  Array.from({ length: MAX_TEAM_SIZE }, (_, i) => i + 1),
);

/**
 * How many times a join attempt retries after losing a slot race to a concurrent
 * joiner. Bounded by MAX_TEAM_SIZE: each retry eliminates at least one taken slot,
 * so after MAX_TEAM_SIZE attempts the squad is provably full.
 */
export const JOIN_SLOT_MAX_ATTEMPTS = MAX_TEAM_SIZE;
