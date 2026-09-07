/**
 * Loads the Level 3 catalogue — stations, bugs and hints — from a JSON file.
 *
 *   npm run seed:level3-bugs prisma/level3-catalogue.json
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LOADS
 * ---------------------------------------------------------------------------
 * Structure and value. NOT flags: flag custody belongs to ORION, which is the
 * only system that verifies a discovery. This portal needs the catalogue so it
 * can resolve an inbound integration event to a bug, look up the official point
 * value, and render progress — none of which requires knowing an answer.
 *
 * `points` is optional per bug: omit it and the difficulty tier's default is
 * used (EASY 100 / MEDIUM 200 / HARD 300 / CRITICAL 500). Set it explicitly to
 * price a bug off-tier. The DATABASE value is authoritative either way — editing
 * the tier defaults in code never reprices a bug that already exists.
 *
 * Re-running is safe. Stations match on `name`, bugs on `externalRef`, hints on
 * (bug, hintNumber); everything is updated in place, so a corrected title or
 * point value never orphans discoveries or penalties already earned against it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { defaultPointsForDifficulty, isLevel3Difficulty } from '../src/lib/level3/scoring-policy';

const prisma = new PrismaClient();

interface HintDefinition {
  hintNumber: number;
  content: string;
}

interface BugDefinition {
  externalRef: string;
  code: string;
  title: string;
  difficulty: string;
  points: number;
  category?: string;
  isActive?: boolean;
  sortOrder: number;
  hints: HintDefinition[];
}

interface StationDefinition {
  name: string;
  description?: string;
  challengeUrl?: string;
  challengeLabel?: string;
  sortOrder: number;
  isActive?: boolean;
  bugs: BugDefinition[];
}

function fail(message: string): never {
  throw new Error(message);
}

function parseCatalogue(path: string): StationDefinition[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) fail('Catalogue must be a JSON array of station objects.');

  const seenRefs = new Set<string>();
  const seenCodes = new Set<string>();

  return parsed.map((rawStation, sIndex) => {
    if (typeof rawStation !== 'object' || rawStation === null) {
      fail(`Station ${sIndex} is not an object.`);
    }
    const st = rawStation as Record<string, unknown>;
    const name = String(st['name'] ?? '').trim();
    if (!name) fail(`Station ${sIndex} is missing "name".`);

    const rawBugs = Array.isArray(st['bugs']) ? st['bugs'] : [];
    const bugs: BugDefinition[] = rawBugs.map((rawBug, bIndex) => {
      if (typeof rawBug !== 'object' || rawBug === null) {
        fail(`Station "${name}" bug ${bIndex} is not an object.`);
      }
      const b = rawBug as Record<string, unknown>;

      const externalRef = String(b['externalRef'] ?? '').trim();
      const code = String(b['code'] ?? '').trim();
      const title = String(b['title'] ?? '').trim();
      const difficulty = String(b['difficulty'] ?? 'EASY')
        .trim()
        .toUpperCase();

      if (!externalRef) fail(`Station "${name}" bug ${bIndex} is missing "externalRef".`);
      if (!code) fail(`Bug ${externalRef} is missing "code".`);
      if (!title) fail(`Bug ${externalRef} is missing "title".`);
      if (!isLevel3Difficulty(difficulty)) {
        fail(`Bug ${externalRef} has unknown difficulty "${difficulty}".`);
      }
      // Caught here rather than by the unique index, so the operator sees which
      // value collided instead of a Prisma error part-way through the load.
      if (seenRefs.has(externalRef)) fail(`Duplicate externalRef "${externalRef}".`);
      if (seenCodes.has(code)) fail(`Duplicate code "${code}".`);
      seenRefs.add(externalRef);
      seenCodes.add(code);

      const explicitPoints = b['points'];
      const points =
        explicitPoints === undefined || explicitPoints === null
          ? defaultPointsForDifficulty(difficulty)
          : Number(explicitPoints);
      if (!Number.isInteger(points) || points < 0) {
        fail(`Bug ${externalRef} has a non-integer or negative "points".`);
      }

      const rawHints = Array.isArray(b['hints']) ? b['hints'] : [];
      const hints: HintDefinition[] = rawHints.map((rawHint, hIndex) => {
        const h = rawHint as Record<string, unknown>;
        const hintNumber = Number(h['hintNumber']);
        const content = String(h['content'] ?? '').trim();
        if (hintNumber !== 1 && hintNumber !== 2) {
          fail(`Bug ${externalRef} hint ${hIndex} must have hintNumber 1 or 2.`);
        }
        if (!content) fail(`Bug ${externalRef} hint ${hintNumber} has empty content.`);
        return { hintNumber, content };
      });

      const definition: BugDefinition = {
        externalRef,
        code,
        title,
        difficulty,
        points,
        sortOrder: Number(b['sortOrder'] ?? bIndex + 1),
        hints,
      };
      if (typeof b['category'] === 'string') definition.category = b['category'];
      if (typeof b['isActive'] === 'boolean') definition.isActive = b['isActive'];
      return definition;
    });

    const station: StationDefinition = {
      name,
      sortOrder: Number(st['sortOrder'] ?? sIndex + 1),
      bugs,
    };
    if (typeof st['description'] === 'string') station.description = st['description'];
    if (typeof st['challengeUrl'] === 'string') station.challengeUrl = st['challengeUrl'];
    if (typeof st['challengeLabel'] === 'string') station.challengeLabel = st['challengeLabel'];
    if (typeof st['isActive'] === 'boolean') station.isActive = st['isActive'];
    return station;
  });
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx scripts/seed-level3-bugs.ts <catalogue.json>');
    process.exit(1);
  }

  const stations = parseCatalogue(resolve(process.cwd(), arg));
  const bugCount = stations.reduce((n, s) => n + s.bugs.length, 0);
  console.log(`Loading ${stations.length} station(s) and ${bugCount} bug(s) from ${arg}\n`);

  for (const st of stations) {
    const existingStation = await prisma.level3Station.findFirst({
      where: { name: st.name },
      select: { id: true },
    });

    const stationData = {
      description: st.description ?? null,
      challengeUrl: st.challengeUrl ?? null,
      challengeLabel: st.challengeLabel ?? null,
      sortOrder: st.sortOrder,
      isActive: st.isActive ?? true,
    };

    const station = existingStation
      ? await prisma.level3Station.update({ where: { id: existingStation.id }, data: stationData })
      : await prisma.level3Station.create({ data: { name: st.name, ...stationData } });

    console.log(`  ${existingStation ? 'updated' : 'created'} station  ${st.name}`);

    for (const bug of st.bugs) {
      const bugData = {
        code: bug.code,
        title: bug.title,
        difficulty: bug.difficulty,
        points: bug.points,
        category: bug.category ?? 'WEB',
        isActive: bug.isActive ?? true,
        stationId: station.id,
        sortOrder: bug.sortOrder,
      };

      const existingBug = await prisma.level3Bug.findUnique({
        where: { externalRef: bug.externalRef },
        select: { id: true },
      });

      const saved = existingBug
        ? await prisma.level3Bug.update({ where: { id: existingBug.id }, data: bugData })
        : await prisma.level3Bug.create({ data: { ...bugData, externalRef: bug.externalRef } });

      for (const hint of bug.hints) {
        await prisma.level3Hint.upsert({
          where: { bugId_hintNumber: { bugId: saved.id, hintNumber: hint.hintNumber } },
          update: { content: hint.content },
          create: { bugId: saved.id, hintNumber: hint.hintNumber, content: hint.content },
        });
      }

      console.log(
        `    ${existingBug ? 'updated' : 'created'}  ${bug.code.padEnd(6)} ` +
          `${bug.difficulty.padEnd(8)} ${String(bug.points).padStart(4)} pts  ` +
          `${bug.hints.length} hint(s)  ${bug.title}`,
      );
    }
  }

  const totals = await prisma.level3Bug.aggregate({
    where: { isActive: true },
    _sum: { points: true },
    _count: { _all: true },
  });
  const stationTotal = await prisma.level3Station.count({ where: { isActive: true } });

  console.log(
    `\nActive: ${stationTotal} station(s), ${totals._count._all} bug(s).\n` +
      `Maximum automatic Level 3 score: ${totals._sum.points ?? 0} points.`,
  );
}

main()
  .catch((err) => {
    console.error('\nLevel 3 catalogue seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
