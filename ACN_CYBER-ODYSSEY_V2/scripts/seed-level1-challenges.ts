/**
 * Seeds the Level 1 challenge catalogue.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TABLE EXISTS
 * ---------------------------------------------------------------------------
 * The Level 1 application decides whether an answer is CORRECT. This portal
 * decides what a correct answer is WORTH. Level 1 is intentionally vulnerable, so
 * a point value arriving from it would be a point value a participant could
 * eventually choose. The catalogue below is the portal's own authority.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST STAY IN STEP, AND WHAT MUST NOT
 * ---------------------------------------------------------------------------
 * MUST match the Level 1 application:
 *   - `externalRef` — the question code Level 1 puts on the wire. A mismatch
 *     means the event is rejected as UNKNOWN_CHALLENGE and the squad silently
 *     scores nothing. `npm run seed:level1` prints the full list so it can be
 *     eyeballed against Level 1's lib/track*.js.
 *
 * MUST NOT be copied from the Level 1 application:
 *   - the answers. They stay in Level 1, which is the only system that verifies
 *     them, for the same reason flag custody for Level 3 belongs to ORION.
 *
 * The point values below mirror Level 1's own per-question values so that a
 * squad's Level 1 screen and the portal leaderboard agree. They are the portal's
 * to change: repricing here is a deliberate event decision and does NOT rewrite
 * scores already earned, because Level1Result snapshots the award.
 *
 * Re-running is safe. Rows are matched on `externalRef`; existing rows are
 * updated in place, so a squad's results survive a catalogue correction.
 *
 * Usage:  npm run seed:level1
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CatalogueEntry {
  /** The question code Level 1 sends. Must match Level 1 exactly. */
  externalRef: string;
  /** Participant-facing label. */
  code: string;
  title: string;
  track: 'A' | 'B' | 'C';
  points: number;
}

/**
 * Level 1 catalogue — 11 scored questions across three tracks, 100 points total.
 *
 * Track A  lib/trackA.js  QUESTIONS  (A1 5, A2 5, A3 10, A4 10)   = 30
 * Track B  lib/trackB.js  QUESTIONS  (B1 5, B2 5, B3 10, B4 10)   = 30
 * Track C  lib/trackC.js  verifyChain 15, verifyVolatility 15, verifyC3 10 = 40
 */
const CATALOGUE: CatalogueEntry[] = [
  {
    externalRef: 'A1',
    code: 'A1',
    track: 'A',
    points: 5,
    title: 'Spoofed Relay vs True Origin Server',
  },
  {
    externalRef: 'A2',
    code: 'A2',
    track: 'A',
    points: 5,
    title: 'Follow the Chained Open Redirect Target',
  },
  {
    externalRef: 'A3',
    code: 'A3',
    track: 'A',
    points: 10,
    title: 'DMARC Header Domain Alignment Audit',
  },
  {
    externalRef: 'A4',
    code: 'A4',
    track: 'A',
    points: 10,
    title: 'Decode Hex-Encoded SOC Reference',
  },
  {
    externalRef: 'B1',
    code: 'B1',
    track: 'B',
    points: 5,
    title: "Usable Session Duration ('nbf' Clock Skew)",
  },
  {
    externalRef: 'B2',
    code: 'B2',
    track: 'B',
    points: 5,
    title: 'Scope Permission Array Override',
  },
  { externalRef: 'B3', code: 'B3', track: 'B', points: 10, title: 'Key ID Path Traversal Audit' },
  {
    externalRef: 'B4',
    code: 'B4',
    track: 'B',
    points: 10,
    title: 'Algorithm Confusion Attack Vector',
  },
  {
    externalRef: 'C1',
    code: 'C1',
    track: 'C',
    points: 15,
    title: 'Threat Graph Pinboard — Attack Chain',
  },
  {
    externalRef: 'C2',
    code: 'C2',
    track: 'C',
    points: 15,
    title: 'Order of Volatility Sorter (RFC 3227)',
  },
  { externalRef: 'C3', code: 'C3', track: 'C', points: 10, title: 'Power-Loss Volatility Audit' },
];

const EXPECTED_TOTAL = 100;

async function main() {
  const total = CATALOGUE.reduce((sum, entry) => sum + entry.points, 0);
  if (total !== EXPECTED_TOTAL) {
    // A guard, not a limit: the total is a fact about the event that the
    // organisers publish. A silent drift here means the published maximum and the
    // achievable maximum disagree, which participants notice before we do.
    console.error(
      `Catalogue totals ${total} points but the event publishes ${EXPECTED_TOTAL}. ` +
        'Update EXPECTED_TOTAL deliberately if the event scale really changed.',
    );
    process.exit(1);
  }

  const refs = new Set(CATALOGUE.map((c) => c.externalRef));
  if (refs.size !== CATALOGUE.length) {
    console.error('Duplicate externalRef in the catalogue.');
    process.exit(1);
  }

  console.warn(`Seeding ${CATALOGUE.length} Level 1 challenges (${total} points total)...`);

  let created = 0;
  let updated = 0;

  for (const [index, entry] of CATALOGUE.entries()) {
    const existing = await prisma.level1Challenge.findUnique({
      where: { externalRef: entry.externalRef },
      select: { id: true },
    });

    const data = {
      code: entry.code,
      title: entry.title,
      track: entry.track,
      points: entry.points,
      isActive: true,
      sortOrder: index,
    };

    if (existing) {
      await prisma.level1Challenge.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.level1Challenge.create({
        data: { ...data, externalRef: entry.externalRef },
      });
      created += 1;
    }

    console.warn(
      `  ${entry.externalRef.padEnd(4)} ${String(entry.points).padStart(3)} pts  ${entry.title}`,
    );
  }

  console.warn(`\nDone. ${created} created, ${updated} updated.`);
  console.warn(
    'Verify every externalRef above matches a question code the Level 1 ' +
      'application sends (lib/trackA.js, lib/trackB.js, lib/trackC.js).',
  );
}

main()
  .catch((err) => {
    console.error('Level 1 catalogue seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
