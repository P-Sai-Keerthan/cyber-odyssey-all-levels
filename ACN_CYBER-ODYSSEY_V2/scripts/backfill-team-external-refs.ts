/**
 * Backfills `Team.externalRef` for squads created before the Phase 1 migration.
 *
 * The migration itself (20260905090000_level1_integration_foundation) already
 * fills every NULL using SQLite's `randomblob`. This script exists for the two
 * cases that migration cannot cover:
 *
 *   1. A deployment where the migration ran against a different datasource — a
 *      PostgreSQL move, for instance, where `randomblob` does not exist.
 *   2. A verification pass. Running it after the migration should report zero
 *      squads needing a reference; anything else is a signal worth chasing before
 *      the event, because a squad without a reference is invisible to Level 1 and
 *      ORION and its score would silently never arrive.
 *
 * Idempotent: only ever fills NULLs, never rewrites an existing value. Rewriting
 * one would orphan every result already recorded against it.
 *
 * Usage:  npm run backfill:team-refs
 *         npm run backfill:team-refs -- --check     (report only, write nothing)
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { generateExternalTeamRef } from '../src/lib/team/external-ref';

const prisma = new PrismaClient();

/** Bounded retry: a 128-bit collision is not expected, but must not be a crash. */
const MAX_ATTEMPTS_PER_TEAM = 5;

async function main() {
  const checkOnly = process.argv.includes('--check');

  const pending = await prisma.team.findMany({
    where: { externalRef: null },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const total = await prisma.team.count();

  if (pending.length === 0) {
    console.warn(`All ${total} squads carry an external reference. Nothing to do.`);
    return;
  }

  console.warn(`${pending.length} of ${total} squads have no external reference.`);

  if (checkOnly) {
    for (const team of pending) console.warn(`  needs a reference: "${team.name}"`);
    console.warn('\n--check specified; nothing was written.');
    process.exitCode = 1;
    return;
  }

  let filled = 0;

  for (const team of pending) {
    let done = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TEAM && !done; attempt++) {
      try {
        // `externalRef: null` in the WHERE clause makes this safe to run
        // concurrently with itself and with live team creation: a squad that
        // acquired a reference in between is skipped rather than overwritten.
        const result = await prisma.team.updateMany({
          where: { id: team.id, externalRef: null },
          data: { externalRef: generateExternalTeamRef() },
        });
        if (result.count === 1) filled += 1;
        done = true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue; // collided; generate another
        }
        throw err;
      }
    }

    if (!done) {
      console.error(`Could not allocate a unique reference for "${team.name}" — aborting.`);
      process.exit(1);
    }
  }

  const remaining = await prisma.team.count({ where: { externalRef: null } });
  console.warn(`Filled ${filled}. ${remaining} squads still without a reference.`);
  if (remaining > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
