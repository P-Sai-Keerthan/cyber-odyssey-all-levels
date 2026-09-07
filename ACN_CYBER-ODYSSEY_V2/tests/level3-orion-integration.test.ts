/**
 * ORION → Cyber Odyssey Level 3 integration bridge.
 *
 * These tests drive the REAL route handler with real HTTP semantics and assert
 * SERVER-SIDE state: rows in Level3Discovery, rows in IntegrationEvent, and what
 * the leaderboard aggregation returns. A response body claiming success over a
 * database that did not change is exactly the failure mode worth catching.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@/lib/integration/hmac';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import { getTeamAutomaticScore } from '@/lib/level3/scoring';
import { APPROVAL_STATUS } from '@/lib/evaluation/approval';

const SECRET = 'test-integration-secret-value-do-not-use-in-production';
process.env['ODYSSEY_INTEGRATION_SECRET'] = SECRET;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Imported after the env var is set so the route's module graph sees it.
const { POST } = await import('@/app/api/integration/level3/discovery/route');

const PREFIX = 'orion_it_';
const TEAM_A_REF = `${PREFIX}team_alpha`;
const TEAM_B_REF = `${PREFIX}team_bravo`;
const BUG_SQL_REF = `${PREFIX}bug_sqli`;
const BUG_XSS_REF = `${PREFIX}bug_xss`;
const BUG_ZERO_REF = `${PREFIX}bug_zero`;

let teamAId = '';
let teamBId = '';
let userAId = '';

let seq = 0;
function uniq(tag: string) {
  seq += 1;
  return `${PREFIX}${tag}_${seq}_${Date.now()}`;
}

interface EventBody {
  eventId?: string;
  nonce?: string;
  eventType?: string;
  externalTeamRef?: string;
  externalBugRef?: string;
  [k: string]: unknown;
}

function buildRequest(
  body: EventBody,
  opts: { secret?: string; timestamp?: number; signature?: string } = {},
) {
  const raw = JSON.stringify(body);
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = opts.signature ?? signBody(opts.secret ?? SECRET, raw, ts);

  return new Request('http://localhost/api/integration/level3/discovery', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: sig,
      [TIMESTAMP_HEADER]: ts,
    },
    body: raw,
  });
}

async function send(body: EventBody, opts?: Parameters<typeof buildRequest>[1]) {
  const res = await POST(buildRequest(body, opts));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A well-formed discovery event for team A / the SQLi bug. */
function validEvent(overrides: EventBody = {}): EventBody {
  return {
    eventId: uniq('evt'),
    nonce: uniq('nonce'),
    eventType: 'BUG_DISCOVERED',
    externalTeamRef: TEAM_A_REF,
    externalBugRef: BUG_SQL_REF,
    ...overrides,
  };
}

async function setLevel3(status: string, expired = false) {
  const now = Date.now();
  await prisma.levelState.upsert({
    where: { levelNumber: 3 },
    update: {
      status,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(expired ? now - 1000 : now + 3_600_000),
      remainingSeconds: expired ? 0 : 3600,
    },
    create: {
      levelNumber: 3,
      name: 'Level 3',
      codename: 'THE TWELVE AXES',
      status,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(expired ? now - 1000 : now + 3_600_000),
      remainingSeconds: expired ? 0 : 3600,
    },
  });
}

async function cleanup() {
  await prisma.integrationEvent.deleteMany({ where: { eventId: { startsWith: PREFIX } } });
  await prisma.integrationEvent.deleteMany({ where: { externalTeamRef: { startsWith: PREFIX } } });
  await prisma.level3Discovery.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.level3Bug.deleteMany({ where: { externalRef: { startsWith: PREFIX } } });
  await prisma.evaluation.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.submission.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const pwd = await hashPassword('OrionIntegrationTest123!');

  const userA = await prisma.user.create({
    data: {
      email: `${PREFIX}a@example.com`,
      username: `${PREFIX}a`,
      passwordHash: pwd,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
    },
  });
  userAId = userA.id;

  const teamA = await prisma.team.create({
    data: {
      name: `${PREFIX}alpha`,
      code: `${PREFIX}A1`,
      passwordHash: pwd,
      creatorId: userA.id,
      externalRef: TEAM_A_REF,
      members: { create: { userId: userA.id, slot: 1, role: 'LEADER' } },
    },
  });
  const teamB = await prisma.team.create({
    data: {
      name: `${PREFIX}bravo`,
      code: `${PREFIX}B1`,
      passwordHash: pwd,
      creatorId: userA.id,
      externalRef: TEAM_B_REF,
    },
  });
  teamAId = teamA.id;
  teamBId = teamB.id;

  await prisma.level3Bug.createMany({
    data: [
      { code: `${PREFIX}01`, externalRef: BUG_SQL_REF, title: 'SQLi', points: 40 },
      { code: `${PREFIX}02`, externalRef: BUG_XSS_REF, title: 'XSS', points: 25 },
      // A genuinely zero-point bug, to prove 0 survives as an earned score.
      { code: `${PREFIX}03`, externalRef: BUG_ZERO_REF, title: 'Informational', points: 0 },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.levelState
    .update({ where: { levelNumber: 3 }, data: { status: 'LOCKED' } })
    .catch(() => {});
});

beforeEach(async () => {
  await prisma.level3Discovery.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  await prisma.integrationEvent.deleteMany({ where: { externalTeamRef: { startsWith: PREFIX } } });
  await setLevel3('LIVE');
});

describe('HMAC authentication', () => {
  it('accepts a correctly signed event', async () => {
    const { status, json } = await send(validEvent());
    expect(status).toBe(200);
    expect(json['accepted']).toBe(true);
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(1);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const { status, json } = await send(validEvent(), { secret: 'not-the-real-secret' });
    expect(status).toBe(401);
    expect(json['code']).toBe('UNAUTHENTICATED');
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('rejects a tampered body even when the signature is otherwise valid', async () => {
    // Sign one payload, send another — the classic forgery attempt.
    const honest = validEvent();
    const raw = JSON.stringify(honest);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signBody(SECRET, raw, ts);

    const tampered = JSON.stringify({ ...honest, externalTeamRef: TEAM_B_REF });
    const res = await POST(
      new Request('http://localhost/api/integration/level3/discovery', {
        method: 'POST',
        headers: { [SIGNATURE_HEADER]: sig, [TIMESTAMP_HEADER]: ts },
        body: tampered,
      }),
    );

    expect(res.status).toBe(401);
    expect(await prisma.level3Discovery.count({ where: { teamId: teamBId } })).toBe(0);
  });

  it('rejects a missing signature', async () => {
    const res = await POST(
      new Request('http://localhost/api/integration/level3/discovery', {
        method: 'POST',
        headers: { [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)) },
        body: JSON.stringify(validEvent()),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an expired timestamp', async () => {
    const stale = Math.floor(Date.now() / 1000) - 600;
    const { status } = await send(validEvent(), { timestamp: stale });
    expect(status).toBe(401);
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('rejects a timestamp too far in the future', async () => {
    const ahead = Math.floor(Date.now() / 1000) + 600;
    const { status } = await send(validEvent(), { timestamp: ahead });
    expect(status).toBe(401);
  });

  it('does not let the timestamp be edited to refresh a captured request', async () => {
    // Signature covers "<timestamp>.<body>", so moving the timestamp invalidates it.
    const body = validEvent();
    const raw = JSON.stringify(body);
    const originalTs = String(Math.floor(Date.now() / 1000) - 600);
    const sig = signBody(SECRET, raw, originalTs);
    const { status } = await send(body, {
      timestamp: Math.floor(Date.now() / 1000),
      signature: sig,
    });
    expect(status).toBe(401);
  });
});

describe('Replay and idempotency', () => {
  it('absorbs a redelivered event without awarding twice', async () => {
    const event = validEvent();

    const first = await send(event);
    expect(first.status).toBe(200);
    expect(first.json['duplicate']).toBeFalsy();

    // Same eventId AND same nonce — a straight redelivery of the same request.
    const second = await send(event);
    expect(second.status).toBe(200);
    expect(second.json['duplicate']).toBe(true);

    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(1);
    expect((await getTeamAutomaticScore(teamAId)).automaticScore).toBe(40);
  });

  it('rejects a reused nonce under a fresh event id', async () => {
    const first = validEvent();
    await send(first);

    const replayed = validEvent({ nonce: first.nonce! });
    const { status, json } = await send(replayed);

    expect(status).toBe(409);
    expect(json['code']).toBe('NONCE_REUSED');
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(1);
  });

  it('awards once when the same discovery arrives concurrently', async () => {
    // Distinct events for the same (team, bug) — as if ORION retried in parallel.
    const results = await Promise.all(Array.from({ length: 8 }, () => send(validEvent())));
    const accepted = results.filter((r) => r.status === 200);
    expect(accepted.length).toBeGreaterThan(0);

    // The DB unique index is the arbiter, not the application check.
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(1);
    expect((await getTeamAutomaticScore(teamAId)).automaticScore).toBe(40);
  });

  it('records every accepted and rejected event for reconciliation', async () => {
    await send(validEvent());
    await send(validEvent({ externalTeamRef: `${PREFIX}nonexistent` }));

    const rows = await prisma.integrationEvent.findMany({
      where: { externalTeamRef: { startsWith: PREFIX } },
      select: { outcome: true },
    });
    const outcomes = rows.map((r) => r.outcome).sort();
    expect(outcomes).toContain('ACCEPTED');
    expect(outcomes).toContain('REJECTED_UNKNOWN_TEAM');
  });
});

describe('Resolution: the payload names, the portal decides', () => {
  it('ignores a points value supplied by ORION', async () => {
    const { status } = await send(
      validEvent({ points: 99999, awardedPoints: 99999, score: 99999 }),
    );
    expect(status).toBe(200);

    const row = await prisma.level3Discovery.findFirst({ where: { teamId: teamAId } });
    // 40 is this portal's configured value for the bug.
    expect(row?.awardedPoints).toBe(40);
    expect((await getTeamAutomaticScore(teamAId)).automaticScore).toBe(40);
  });

  it('ignores a teamId supplied by ORION and uses the external reference', async () => {
    const { status } = await send(validEvent({ teamId: teamBId, team: teamBId }));
    expect(status).toBe(200);

    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(1);
    expect(await prisma.level3Discovery.count({ where: { teamId: teamBId } })).toBe(0);
  });

  it('rejects an unknown team', async () => {
    const { status, json } = await send(validEvent({ externalTeamRef: `${PREFIX}ghost` }));
    expect(status).toBe(404);
    expect(json['code']).toBe('UNKNOWN_TEAM');
  });

  it('rejects an unknown bug', async () => {
    const { status, json } = await send(validEvent({ externalBugRef: `${PREFIX}ghost_bug` }));
    expect(status).toBe(404);
    expect(json['code']).toBe('UNKNOWN_BUG');
  });

  it('rejects an unsupported event type', async () => {
    const { status, json } = await send(validEvent({ eventType: 'SET_SCORE' }));
    expect(status).toBe(400);
    expect(json['code']).toBe('UNSUPPORTED_EVENT');
  });

  it('rejects a body missing required fields', async () => {
    const { status, json } = await send({ eventId: uniq('e'), nonce: uniq('n') });
    expect(status).toBe(400);
    expect(json['code']).toBe('MISSING_FIELDS');
  });

  it('preserves a genuinely zero-point bug as an earned score', async () => {
    await send(validEvent({ externalBugRef: BUG_ZERO_REF }));
    const score = await getTeamAutomaticScore(teamAId);
    // 0, not null: the squad did find something.
    expect(score.automaticScore).toBe(0);
    expect(score.verifiedBugCount).toBe(1);
  });
});

describe('Level state gating', () => {
  it('rejects discoveries while Level 3 is PAUSED', async () => {
    await setLevel3('PAUSED');
    const { status, json } = await send(validEvent());
    expect(status).toBe(409);
    expect(json['code']).toBe('LEVEL_NOT_LIVE');
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('rejects discoveries once Level 3 is COMPLETED', async () => {
    await setLevel3('COMPLETED');
    const { status } = await send(validEvent());
    expect(status).toBe(409);
    expect(await prisma.level3Discovery.count({ where: { teamId: teamAId } })).toBe(0);
  });

  it('rejects discoveries while Level 3 is LOCKED', async () => {
    await setLevel3('LOCKED');
    const { status } = await send(validEvent());
    expect(status).toBe(409);
  });

  it('rejects discoveries after the level window has expired', async () => {
    await setLevel3('LIVE', true);
    const { status } = await send(validEvent());
    expect(status).toBe(409);
  });
});

describe('Leaderboard composition', () => {
  async function createLevel3Report(teamId: string, score: number, approval: string) {
    const submission = await prisma.submission.create({
      data: { teamId, userId: userAId, level: 3, status: 'SUBMITTED' },
    });
    return prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatorId: userAId,
        teamId,
        level: 3,
        status: 'EVALUATED',
        score,
        maxScore: 100,
        approvalStatus: approval,
        submittedAt: new Date(),
      },
    });
  }

  beforeEach(async () => {
    await prisma.evaluation.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
    await prisma.submission.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  });

  async function level3Row(teamId: string) {
    const standings = await getLeaderboardStandings();
    return standings.rows.find((r) => r.id === teamId);
  }

  it('puts an ingested automatic score on the leaderboard', async () => {
    await send(validEvent());
    const row = await level3Row(teamAId);
    expect(row?.levelScores[3]).toBe(40);
    expect(row?.totalScore).toBe(40);
  });

  it('excludes a report score still pending approval', async () => {
    await send(validEvent());
    await createLevel3Report(teamAId, 30, APPROVAL_STATUS.PENDING_APPROVAL);
    const row = await level3Row(teamAId);
    expect(row?.levelScores[3]).toBe(40);
  });

  it('excludes a rejected report score', async () => {
    await send(validEvent());
    await createLevel3Report(teamAId, 30, APPROVAL_STATUS.REJECTED);
    const row = await level3Row(teamAId);
    expect(row?.levelScores[3]).toBe(40);
  });

  it('adds an approved report score: Level 3 = automatic + approved report', async () => {
    await send(validEvent());
    await send(validEvent({ externalBugRef: BUG_XSS_REF }));
    await createLevel3Report(teamAId, 30, APPROVAL_STATUS.APPROVED);

    const row = await level3Row(teamAId);
    // 40 + 25 automatic = 65, plus the approved 30 = 95.
    expect(row?.levelScores[3]).toBe(95);
  });

  it('keeps the two components independently derivable after approval', async () => {
    await send(validEvent());
    await createLevel3Report(teamAId, 30, APPROVAL_STATUS.APPROVED);

    expect((await getTeamAutomaticScore(teamAId)).automaticScore).toBe(40);
    expect((await level3Row(teamAId))?.levelScores[3]).toBe(70);
  });

  it('leaves Level 3 unscored when neither component is official', async () => {
    await createLevel3Report(teamAId, 30, APPROVAL_STATUS.PENDING_APPROVAL);
    const row = await level3Row(teamAId);
    expect(row?.levelScores[3]).toBeNull();
  });

  it('does not let an ingested Level 3 score leak into Level 1 or Level 2', async () => {
    await send(validEvent());
    const row = await level3Row(teamAId);
    expect(row?.levelScores[1]).toBeNull();
    expect(row?.levelScores[2]).toBeNull();
    expect(row?.levelScores[3]).toBe(40);
  });

  it('keeps one squad isolated from another', async () => {
    await send(validEvent());
    expect((await getTeamAutomaticScore(teamAId)).automaticScore).toBe(40);
    expect((await getTeamAutomaticScore(teamBId)).automaticScore).toBeNull();
  });
});
