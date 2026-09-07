/**
 * Portal <-> Level 1 integration bridge (Phase 1).
 *
 * These tests drive the REAL route handlers with real HTTP semantics and assert
 * SERVER-SIDE state: rows in Level1Result, rows in Level1Penalty, rows in
 * IntegrationTicket and IntegrationEvent, and what the leaderboard aggregation
 * returns. A response body claiming success over a database that did not change
 * is exactly the failure mode worth catching.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import {
  signBody,
  LEVEL1_SIGNATURE_HEADER,
  LEVEL1_TIMESTAMP_HEADER,
  SIGNATURE_HEADER,
} from '@/lib/integration/hmac';
import { getLeaderboardStandings } from '@/lib/leaderboard/standings';
import { getTeamLevel1Score } from '@/lib/level1/scoring';
import { issueTicket, hashTicket, TICKET_TTL_MS } from '@/lib/level1/tickets';
import { generateExternalTeamRef, isWellFormedExternalTeamRef } from '@/lib/team/external-ref';
import { LEVEL1_HINT_PENALTIES } from '@/lib/level1/scoring-policy';

const SECRET = 'test-level1-secret-value-do-not-use-in-production';
const ORION_SECRET = 'test-orion-secret-value-do-not-use-in-production';
process.env['ODYSSEY_LEVEL1_SECRET'] = SECRET;
process.env['ODYSSEY_INTEGRATION_SECRET'] = ORION_SECRET;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { POST: SCORE_POST } = await import('@/app/api/integration/level1/score/route');
const { POST: SESSION_POST } = await import('@/app/api/integration/level1/session/route');

const PREFIX = 'l1_it_';
const TEAM_A_REF = `${PREFIX}team_alpha`;
const TEAM_B_REF = `${PREFIX}team_bravo`;
const CH_A1 = `${PREFIX}A1`;
const CH_A3 = `${PREFIX}A3`;
const CH_ZERO = `${PREFIX}zero`;
const CH_RETIRED = `${PREFIX}retired`;

let teamAId = '';
let teamBId = '';
let userAId = '';

let seq = 0;
function uniq(tag: string) {
  seq += 1;
  return `${PREFIX}${tag}_${seq}_${Date.now()}`;
}

type Body = Record<string, unknown>;

function buildRequest(
  path: string,
  body: Body,
  opts: {
    secret?: string;
    timestamp?: number;
    signature?: string;
    headers?: 'level1' | 'orion';
  } = {},
) {
  const raw = JSON.stringify(body);
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = opts.signature ?? signBody(opts.secret ?? SECRET, raw, ts);
  const sigHeader = opts.headers === 'orion' ? SIGNATURE_HEADER : LEVEL1_SIGNATURE_HEADER;
  const tsHeader = opts.headers === 'orion' ? 'x-orion-timestamp' : LEVEL1_TIMESTAMP_HEADER;

  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [sigHeader]: sig, [tsHeader]: ts },
    body: raw,
  });
}

async function sendScore(body: Body, opts?: Parameters<typeof buildRequest>[2]) {
  const res = await SCORE_POST(buildRequest('/api/integration/level1/score', body, opts));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function sendSession(body: Body, opts?: Parameters<typeof buildRequest>[2]) {
  const res = await SESSION_POST(buildRequest('/api/integration/level1/session', body, opts));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A well-formed solve event for team A / challenge A1. */
function solveEvent(overrides: Body = {}): Body {
  return {
    eventId: uniq('evt'),
    nonce: uniq('nonce'),
    eventType: 'LEVEL1_CHALLENGE_SOLVED',
    externalTeamRef: TEAM_A_REF,
    externalChallengeRef: CH_A1,
    ...overrides,
  };
}

async function setLevel1(status: string, expired = false) {
  const now = Date.now();
  await prisma.levelState.upsert({
    where: { levelNumber: 1 },
    update: {
      status,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(expired ? now - 1000 : now + 3_600_000),
      remainingSeconds: expired ? 0 : 3600,
    },
    create: {
      levelNumber: 1,
      name: 'Level 1',
      codename: 'THE INITIAL TRACE',
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
  await prisma.integrationEvent.deleteMany({
    where: { externalTeamRef: { startsWith: 'ticket:' } },
  });
  await prisma.integrationEvent.deleteMany({ where: { externalTeamRef: { startsWith: 'team:' } } });
  await prisma.integrationTicket.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.level1Result.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.level1Penalty.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.level1Challenge.deleteMany({ where: { externalRef: { startsWith: PREFIX } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: PREFIX } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const pwd = await hashPassword('Level1IntegrationTest123!');

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
      code: `${PREFIX}A1C`,
      passwordHash: pwd,
      creatorId: userA.id,
      externalRef: TEAM_A_REF,
    },
  });
  teamAId = teamA.id;
  await prisma.teamMember.create({
    data: { teamId: teamA.id, userId: userA.id, slot: 1, role: 'CREATOR' },
  });

  const teamB = await prisma.team.create({
    data: {
      name: `${PREFIX}bravo`,
      code: `${PREFIX}B1C`,
      passwordHash: pwd,
      creatorId: userA.id,
      externalRef: TEAM_B_REF,
    },
  });
  teamBId = teamB.id;

  await prisma.level1Challenge.createMany({
    data: [
      { code: `${PREFIX}c1`, externalRef: CH_A1, title: 'A1', track: 'A', points: 5 },
      { code: `${PREFIX}c2`, externalRef: CH_A3, title: 'A3', track: 'A', points: 10 },
      { code: `${PREFIX}c3`, externalRef: CH_ZERO, title: 'Zero', track: 'A', points: 0 },
      {
        code: `${PREFIX}c4`,
        externalRef: CH_RETIRED,
        title: 'Retired',
        track: 'A',
        points: 25,
        isActive: false,
      },
    ],
  });
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await prisma.level1Result.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  await prisma.level1Penalty.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  await prisma.integrationTicket.deleteMany({ where: { teamId: { in: [teamAId, teamBId] } } });
  await setLevel1('LIVE');
});

// ---------------------------------------------------------------------------

describe('external team reference', () => {
  it('generates unguessable, well-formed, unique references', () => {
    const refs = new Set(Array.from({ length: 500 }, () => generateExternalTeamRef()));
    expect(refs.size).toBe(500);
    for (const ref of refs) expect(isWellFormedExternalTeamRef(ref)).toBe(true);
  });

  it('is derived from neither the team code nor the team name', () => {
    // The whole reason the reference is generated: deriving it from the private
    // join code would publish that code to two other systems.
    const ref = generateExternalTeamRef();
    expect(ref).not.toContain('CYB-');
    expect(isWellFormedExternalTeamRef('co_' + 'z'.repeat(32))).toBe(false);
    expect(isWellFormedExternalTeamRef('CYB-7K4M2')).toBe(false);
  });

  it('createTeamAction mints one in the same transaction as the squad', async () => {
    // The production path, and the actual regression risk: a squad created
    // without a reference is invisible to Level 1 and ORION, and its score would
    // silently never arrive.
    //
    // Asserted by reading the source rather than by invoking the action, which
    // would need a Next.js request scope for `cookies()`. A shallow check, but it
    // fails loudly if the field is ever dropped from the create — which is the
    // failure this guards against.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/lib/actions/team-actions.ts', import.meta.url), 'utf8'),
    );
    const createBlock = source.slice(
      source.indexOf('const team = await tx.team.create'),
      source.indexOf('// Squad head always occupies slot 1'),
    );
    expect(createBlock).toContain('externalRef');
    expect(source).toContain('generateExternalTeamRef()');
  });

  // NOTE: whether the MIGRATION backfilled every pre-existing squad is an
  // operational fact, not a unit-testable one — this suite shares a database with
  // suites that create teams directly through Prisma, so a global
  // `count({ where: { externalRef: null } })` here would report their fixtures,
  // not a real gap. Verify the backfill with:  npm run backfill:team-refs -- --check
});

describe('signature verification', () => {
  it('accepts a correctly signed request', async () => {
    const { status, json } = await sendScore(solveEvent());
    expect(status).toBe(200);
    expect(json['accepted']).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    const { status, json } = await sendScore(solveEvent(), { secret: 'not-the-secret' });
    expect(status).toBe(401);
    expect(json['code']).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered body under a valid signature', async () => {
    const honest = solveEvent();
    const raw = JSON.stringify(honest);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signBody(SECRET, raw, ts);

    // Sign one body, send another — the classic re-serialisation bypass.
    const tampered = { ...honest, externalTeamRef: TEAM_B_REF };
    const res = await SCORE_POST(
      new Request('http://localhost/api/integration/level1/score', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [LEVEL1_SIGNATURE_HEADER]: sig,
          [LEVEL1_TIMESTAMP_HEADER]: ts,
        },
        body: JSON.stringify(tampered),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp', async () => {
    const { status } = await sendScore(solveEvent(), {
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });
    expect(status).toBe(401);
  });

  it('rejects a missing signature entirely', async () => {
    const res = await SCORE_POST(
      new Request('http://localhost/api/integration/level1/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(solveEvent()),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses an ORION-signed request: the two bridges' secrets do not cross", async () => {
    // A valid Level 3 event replayed at the Level 1 endpoint carries no signature
    // as far as this route is concerned, because it reads different headers.
    const { status } = await sendScore(solveEvent(), {
      secret: ORION_SECRET,
      headers: 'orion',
    });
    expect(status).toBe(401);
  });

  it('returns 503, not a bypass, when the secret is unset', async () => {
    const saved = process.env['ODYSSEY_LEVEL1_SECRET'];
    delete process.env['ODYSSEY_LEVEL1_SECRET'];
    try {
      const { status, json } = await sendScore(solveEvent());
      expect(status).toBe(503);
      expect(json['code']).toBe('BRIDGE_DISABLED');
    } finally {
      process.env['ODYSSEY_LEVEL1_SECRET'] = saved!;
    }
  });

  it('writes NO audit row for a signature failure', async () => {
    const eventId = uniq('unauth');
    await sendScore(solveEvent({ eventId }), { secret: 'wrong' });
    const row = await prisma.integrationEvent.findUnique({ where: { eventId } });
    // An unauthenticated caller must not be able to fill the nonce space.
    expect(row).toBeNull();
  });
});

describe('team and challenge resolution', () => {
  it('rejects an unknown team reference', async () => {
    const { status, json } = await sendScore(solveEvent({ externalTeamRef: `${PREFIX}nobody` }));
    expect(status).toBe(404);
    expect(json['code']).toBe('UNKNOWN_TEAM');
  });

  it('rejects an unknown challenge reference', async () => {
    const { status, json } = await sendScore(
      solveEvent({ externalChallengeRef: `${PREFIX}nosuch` }),
    );
    expect(status).toBe(404);
    expect(json['code']).toBe('UNKNOWN_CHALLENGE');
  });

  it('rejects a retired challenge', async () => {
    const { status, json } = await sendScore(solveEvent({ externalChallengeRef: CH_RETIRED }));
    expect(status).toBe(409);
    expect(json['code']).toBe('CHALLENGE_INACTIVE');
  });

  it('rejects a non-active squad', async () => {
    await prisma.team.update({ where: { id: teamBId }, data: { status: 'DISQUALIFIED' } });
    try {
      const { status, json } = await sendScore(solveEvent({ externalTeamRef: TEAM_B_REF }));
      expect(status).toBe(409);
      expect(json['code']).toBe('TEAM_INACTIVE');
    } finally {
      await prisma.team.update({ where: { id: teamBId }, data: { status: 'ACTIVE' } });
    }
  });

  it('records every rejection so a missing score can be explained', async () => {
    const eventId = uniq('rejected');
    await sendScore(solveEvent({ eventId, externalChallengeRef: `${PREFIX}nosuch` }));
    const row = await prisma.integrationEvent.findUnique({ where: { eventId } });
    expect(row?.outcome).toBe('REJECTED_UNKNOWN_CHALLENGE');
    expect(row?.source).toBe('LEVEL1');
  });
});

describe('the client cannot choose the score', () => {
  it('ignores points supplied in the request body', async () => {
    const { status, json } = await sendScore(
      solveEvent({
        points: 9999,
        score: 9999,
        awardedPoints: 9999,
        // A1 is worth 5 in the catalogue.
      }),
    );
    expect(status).toBe(200);
    expect(json['awardedPoints']).toBe(5);

    const row = await prisma.level1Result.findFirst({ where: { teamId: teamAId } });
    expect(row?.awardedPoints).toBe(5);
  });

  it('ignores a team id supplied in the request body', async () => {
    // The only accepted identifier is externalTeamRef, resolved server-side.
    const { status } = await sendScore(
      solveEvent({ teamId: teamBId, team: teamBId, internalTeamId: teamBId }),
    );
    expect(status).toBe(200);

    const forA = await prisma.level1Result.count({ where: { teamId: teamAId } });
    const forB = await prisma.level1Result.count({ where: { teamId: teamBId } });
    expect(forA).toBe(1);
    expect(forB).toBe(0);
  });

  it('scores a zero-point challenge as 0, not as an error and not as null', async () => {
    const { status, json } = await sendScore(solveEvent({ externalChallengeRef: CH_ZERO }));
    expect(status).toBe(200);
    expect(json['awardedPoints']).toBe(0);

    const score = await getTeamLevel1Score(teamAId);
    expect(score.officialScore).toBe(0);
    expect(score.solvedCount).toBe(1);
  });

  it('charges the portal hint penalty, not one supplied by the caller', async () => {
    const { status, json } = await sendScore(
      solveEvent({
        eventType: 'LEVEL1_HINT_UNLOCKED',
        hintNumber: 1,
        points: 0,
        penaltyPoints: 0,
      }),
    );
    expect(status).toBe(200);
    expect(json['penaltyPoints']).toBe(LEVEL1_HINT_PENALTIES[1]);

    const row = await prisma.level1Penalty.findFirst({ where: { teamId: teamAId } });
    expect(row?.points).toBe(LEVEL1_HINT_PENALTIES[1]);
  });

  it('rejects an unrecognised hint tier', async () => {
    const { status, json } = await sendScore(
      solveEvent({ eventType: 'LEVEL1_HINT_UNLOCKED', hintNumber: 7 }),
    );
    expect(status).toBe(400);
    expect(json['code']).toBe('INVALID_HINT_NUMBER');
  });

  it('rejects an unsupported event type', async () => {
    const { status, json } = await sendScore(solveEvent({ eventType: 'GIVE_ME_POINTS' }));
    expect(status).toBe(400);
    expect(json['code']).toBe('UNSUPPORTED_EVENT');
  });
});

describe('idempotency and replay', () => {
  it('absorbs a redelivery of the same eventId without awarding twice', async () => {
    const event = solveEvent();
    const first = await sendScore(event);
    expect(first.json['accepted']).toBe(true);
    expect(first.json['duplicate']).toBe(false);

    // Same eventId, fresh nonce — a legitimate retry after a timeout.
    const second = await sendScore({ ...event, nonce: uniq('nonce') });
    expect(second.status).toBe(200);
    expect(second.json['accepted']).toBe(true);
    expect(second.json['duplicate']).toBe(true);

    const count = await prisma.level1Result.count({ where: { teamId: teamAId } });
    expect(count).toBe(1);
  });

  it('refuses a reused nonce under a different eventId', async () => {
    const event = solveEvent();
    await sendScore(event);

    const { status, json } = await sendScore({
      ...event,
      eventId: uniq('evt'),
      nonce: event['nonce'],
    });
    expect(status).toBe(409);
    expect(json['code']).toBe('NONCE_REUSED');
  });

  it('awards nothing the second time the same challenge is reported under a new eventId', async () => {
    await sendScore(solveEvent());
    const second = await sendScore(solveEvent());

    expect(second.status).toBe(200);
    expect(second.json['duplicate']).toBe(true);
    expect(second.json['awardedPoints']).toBe(0);

    const count = await prisma.level1Result.count({ where: { teamId: teamAId } });
    expect(count).toBe(1);
  });

  it('does not double-charge a hint reported twice', async () => {
    const hint = solveEvent({ eventType: 'LEVEL1_HINT_UNLOCKED', hintNumber: 1 });
    await sendScore(hint);
    await sendScore({ ...hint, eventId: uniq('evt'), nonce: uniq('nonce') });

    const count = await prisma.level1Penalty.count({ where: { teamId: teamAId } });
    expect(count).toBe(1);
  });

  it('survives concurrent delivery of the same challenge', async () => {
    // Two copies in flight at once both pass any read-then-write guard; only the
    // unique index can arbitrate.
    const results = await Promise.all([
      sendScore(solveEvent()),
      sendScore(solveEvent()),
      sendScore(solveEvent()),
    ]);
    for (const r of results) expect(r.status).toBe(200);

    const count = await prisma.level1Result.count({ where: { teamId: teamAId } });
    expect(count).toBe(1);
  });
});

describe('level state gating', () => {
  for (const status of ['LOCKED', 'READY', 'PAUSED', 'COMPLETED']) {
    it(`refuses events while Level 1 is ${status}`, async () => {
      await setLevel1(status);
      const { status: httpStatus, json } = await sendScore(solveEvent());
      expect(httpStatus).toBe(409);
      expect(json['code']).toBe('LEVEL_NOT_LIVE');
      expect(await prisma.level1Result.count({ where: { teamId: teamAId } })).toBe(0);
    });
  }

  it('refuses events once the level has expired', async () => {
    await setLevel1('LIVE', true);
    const { status, json } = await sendScore(solveEvent());
    expect(status).toBe(409);
    expect(json['code']).toBe('LEVEL_NOT_LIVE');
  });

  it('records the level rejection with the state that caused it', async () => {
    await setLevel1('PAUSED');
    const eventId = uniq('paused');
    await sendScore(solveEvent({ eventId }));
    const row = await prisma.integrationEvent.findUnique({ where: { eventId } });
    expect(row?.outcome).toBe('REJECTED_LEVEL_PAUSED');
  });
});

describe('one-time exchange tickets', () => {
  it('accepts a valid ticket exactly once', async () => {
    const { ticket } = await issueTicket({ teamId: teamAId, level: 1, issuedToUserId: userAId });

    const first = await sendSession({ requestId: uniq('req'), nonce: uniq('n'), ticket });
    expect(first.status).toBe(200);
    expect(first.json['accepted']).toBe(true);
    expect(first.json['externalTeamRef']).toBe(TEAM_A_REF);
    expect(first.json['teamName']).toBe(`${PREFIX}alpha`);

    const second = await sendSession({ requestId: uniq('req'), nonce: uniq('n'), ticket });
    expect(second.status).toBe(409);
    expect(second.json['code']).toBe('TICKET_SPENT');
  });

  it('never returns the internal team id, join code or password hash', async () => {
    const { ticket } = await issueTicket({ teamId: teamAId, level: 1 });
    const { json } = await sendSession({ requestId: uniq('req'), nonce: uniq('n'), ticket });

    const serialised = JSON.stringify(json);
    expect(serialised).not.toContain(teamAId);
    expect(serialised).not.toContain(`${PREFIX}A1C`);
    expect(json['passwordHash']).toBeUndefined();
  });

  it('stores only the hash of a ticket, never the ticket', async () => {
    const { ticket } = await issueTicket({ teamId: teamAId, level: 1 });
    const byHash = await prisma.integrationTicket.findUnique({
      where: { tokenHash: hashTicket(ticket) },
    });
    expect(byHash).not.toBeNull();

    const rows = await prisma.integrationTicket.findMany({ where: { teamId: teamAId } });
    for (const row of rows) expect(row.tokenHash).not.toBe(ticket);
    expect(hashTicket(ticket)).toBe(createHash('sha256').update(ticket, 'utf8').digest('hex'));
  });

  it('rejects an expired ticket', async () => {
    const { ticket } = await issueTicket({
      teamId: teamAId,
      level: 1,
      now: new Date(Date.now() - TICKET_TTL_MS - 5_000),
    });
    const { status, json } = await sendSession({
      requestId: uniq('req'),
      nonce: uniq('n'),
      ticket,
    });
    expect(status).toBe(410);
    expect(json['code']).toBe('TICKET_EXPIRED');
  });

  it('rejects a forged ticket', async () => {
    const { status, json } = await sendSession({
      requestId: uniq('req'),
      nonce: uniq('n'),
      ticket: 'f'.repeat(64),
    });
    expect(status).toBe(409);
    expect(json['code']).toBe('TICKET_UNKNOWN');
  });

  it('rejects a malformed ticket', async () => {
    const { status, json } = await sendSession({
      requestId: uniq('req'),
      nonce: uniq('n'),
      ticket: '../../etc/passwd',
    });
    expect(status).toBe(409);
    expect(json['code']).toBe('TICKET_MALFORMED');
  });

  it('rejects an unsigned redemption even with a genuine ticket', async () => {
    const { ticket } = await issueTicket({ teamId: teamAId, level: 1 });
    const res = await SESSION_POST(
      new Request('http://localhost/api/integration/level1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: uniq('req'), nonce: uniq('n'), ticket }),
      }),
    );
    expect(res.status).toBe(401);

    // And the ticket must survive: an unauthenticated caller cannot burn it.
    const still = await sendSession({ requestId: uniq('req'), nonce: uniq('n'), ticket });
    expect(still.status).toBe(200);
  });

  it('issues at most one live ticket per squad', async () => {
    const first = await issueTicket({ teamId: teamAId, level: 1 });
    const second = await issueTicket({ teamId: teamAId, level: 1 });

    // The earlier ticket is expired by the later issue, so a stale tab cannot be
    // used after the participant has clicked again.
    const stale = await sendSession({
      requestId: uniq('req'),
      nonce: uniq('n'),
      ticket: first.ticket,
    });
    expect(stale.status).toBe(410);

    const fresh = await sendSession({
      requestId: uniq('req'),
      nonce: uniq('n'),
      ticket: second.ticket,
    });
    expect(fresh.status).toBe(200);
  });

  it('refuses redemption while Level 1 is not live', async () => {
    await setLevel1('LOCKED');
    const { ticket } = await issueTicket({ teamId: teamAId, level: 1 });
    const { status, json } = await sendSession({
      requestId: uniq('req'),
      nonce: uniq('n'),
      ticket,
    });
    expect(status).toBe(409);
    expect(json['code']).toBe('LEVEL_NOT_LIVE');
  });

  it('refuses a replayed redemption request', async () => {
    const requestId = uniq('req');
    const nonce = uniq('n');
    const first = await issueTicket({ teamId: teamAId, level: 1 });
    await sendSession({ requestId, nonce, ticket: first.ticket });

    const second = await issueTicket({ teamId: teamAId, level: 1 });
    const replay = await sendSession({ requestId, nonce, ticket: second.ticket });
    expect(replay.status).toBe(409);
    expect(replay.json['code']).toBe('REQUEST_REPLAYED');
  });

  it('a ticket for one squad never resolves to another', async () => {
    const { ticket } = await issueTicket({ teamId: teamBId, level: 1 });
    const { json } = await sendSession({ requestId: uniq('req'), nonce: uniq('n'), ticket });
    expect(json['externalTeamRef']).toBe(TEAM_B_REF);
    expect(json['externalTeamRef']).not.toBe(TEAM_A_REF);
  });
});

describe('cross-team isolation', () => {
  it('keeps two squads’ results and scores separate', async () => {
    await sendScore(solveEvent()); // A -> A1 (5)
    await sendScore(solveEvent({ externalChallengeRef: CH_A3 })); // A -> A3 (10)
    await sendScore(solveEvent({ externalTeamRef: TEAM_B_REF })); // B -> A1 (5)

    const a = await getTeamLevel1Score(teamAId);
    const b = await getTeamLevel1Score(teamBId);

    expect(a.officialScore).toBe(15);
    expect(a.solvedCount).toBe(2);
    expect(b.officialScore).toBe(5);
    expect(b.solvedCount).toBe(1);
  });

  it('a hint charged to one squad does not reduce another', async () => {
    await sendScore(solveEvent({ externalChallengeRef: CH_A3 })); // A: +10
    await sendScore(solveEvent({ externalTeamRef: TEAM_B_REF, externalChallengeRef: CH_A3 })); // B: +10
    await sendScore(
      solveEvent({ eventType: 'LEVEL1_HINT_UNLOCKED', hintNumber: 1, externalChallengeRef: CH_A3 }),
    ); // A: -5

    expect((await getTeamLevel1Score(teamAId)).officialScore).toBe(10 - LEVEL1_HINT_PENALTIES[1]!);
    expect((await getTeamLevel1Score(teamBId)).officialScore).toBe(10);
  });
});

describe('score derivation', () => {
  it('clamps a negative net at zero rather than dragging the event total down', async () => {
    // A hint on a 5-point question costs 5: net zero, never negative.
    await sendScore(solveEvent()); // +5
    await sendScore(solveEvent({ eventType: 'LEVEL1_HINT_UNLOCKED', hintNumber: 1 })); // -5

    const score = await getTeamLevel1Score(teamAId);
    expect(score.officialScore).toBe(0);
    expect(score.resultPoints).toBe(5);
    expect(score.penaltyPoints).toBe(5);
  });

  it('is null for a squad that has not started, and 0 for one that only spent a hint', async () => {
    expect((await getTeamLevel1Score(teamAId)).officialScore).toBeNull();

    await sendScore(solveEvent({ eventType: 'LEVEL1_HINT_UNLOCKED', hintNumber: 1 }));
    expect((await getTeamLevel1Score(teamAId)).officialScore).toBe(0);
  });

  it('snapshots the award so re-pricing a challenge does not rewrite earned scores', async () => {
    await sendScore(solveEvent()); // A1 at 5

    await prisma.level1Challenge.update({
      where: { externalRef: CH_A1 },
      data: { points: 999 },
    });
    try {
      const score = await getTeamLevel1Score(teamAId);
      expect(score.officialScore).toBe(5);
    } finally {
      await prisma.level1Challenge.update({ where: { externalRef: CH_A1 }, data: { points: 5 } });
    }
  });
});

describe('leaderboard integration', () => {
  it('carries the Level 1 score into the standings and the total', async () => {
    await sendScore(solveEvent()); // +5
    await sendScore(solveEvent({ externalChallengeRef: CH_A3 })); // +10

    const standings = await getLeaderboardStandings();
    const row = standings.rows.find((r) => r.id === teamAId);

    expect(row).toBeDefined();
    expect(row!.levelScores[1]).toBe(15);
    expect(row!.hasOfficialScore).toBe(true);
    expect(row!.totalScore).toBe(15);
    expect(row!.rank).not.toBeNull();
  });

  it('shows an em dash (null), not zero, for a squad that never entered Level 1', async () => {
    const standings = await getLeaderboardStandings();
    const row = standings.rows.find((r) => r.id === teamBId);
    expect(row!.levelScores[1]).toBeNull();
  });

  it('ranks a higher Level 1 score above a lower one', async () => {
    await sendScore(solveEvent()); // A: 5
    await sendScore(solveEvent({ externalChallengeRef: CH_A3 })); // A: +10 = 15
    await sendScore(solveEvent({ externalTeamRef: TEAM_B_REF })); // B: 5

    const standings = await getLeaderboardStandings();
    const a = standings.rows.find((r) => r.id === teamAId)!;
    const b = standings.rows.find((r) => r.id === teamBId)!;

    expect(a.totalScore).toBe(15);
    expect(b.totalScore).toBe(5);
    expect(a.rank!).toBeLessThan(b.rank!);
  });

  it('adds Level 1 to an existing Level 2 score rather than replacing it', async () => {
    // The eventual model is FINAL = L1 + L2 + L3. Phase 1 connects L1; this
    // asserts it composes with the untouched Level 2 pipeline.
    const submission = await prisma.submission.create({
      data: { teamId: teamAId, userId: userAId, level: 2, status: 'ACCEPTED' },
    });
    const evaluation = await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        evaluatorId: userAId,
        teamId: teamAId,
        level: 2,
        status: 'EVALUATED',
        score: 40,
        approvalStatus: 'APPROVED',
      },
    });

    try {
      await sendScore(solveEvent()); // L1: +5

      const standings = await getLeaderboardStandings();
      const row = standings.rows.find((r) => r.id === teamAId)!;

      expect(row.levelScores[1]).toBe(5);
      expect(row.levelScores[2]).toBe(40);
      expect(row.totalScore).toBe(45);
    } finally {
      await prisma.evaluation.delete({ where: { id: evaluation.id } });
      await prisma.submission.delete({ where: { id: submission.id } });
    }
  });
});

describe('signature parity with the Level 1 application', () => {
  it('produces the exact signature the Level 1 signer pins', () => {
    // FIXED VECTOR. lib/integrationSignature.js in the Level 1 application pins
    // the SAME secret, timestamp, body and expected output in
    // scripts/test-integration.js. If either implementation drifts — a different
    // join, a different encoding, a re-serialised body — one of the two suites
    // fails before anyone deploys.
    const secret = 'parity-fixture-secret';
    const timestamp = '1770886800';
    const body = '{"eventId":"fixture","eventType":"LEVEL1_CHALLENGE_SOLVED"}';

    expect(signBody(secret, body, timestamp)).toBe(
      'sha256=5bb8b69983127bec641a206e191cb5a44c37ea69753ef41a97459e9c7bd09cb8',
    );
  });
});
